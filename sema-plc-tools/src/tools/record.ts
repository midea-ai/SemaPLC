// plc_record — decode the flight-recorder ring buffer (0x46 client in
// client/record.ts) into agent-sized series, with three context-explosion
// gates and an md5 program-version gate:
//   gate 1: varNames is REQUIRED — a full-variableMap dump is forbidden.
//   gate 2: changes-only encoding + transition cap (50) → summary when exceeded.
//   gate 3: anything truncated lands the FULL decoded window on disk
//           (fullDumpFile), never in the tool response.
//   md5 gate: the recorder header carries the md5 of the program that produced
//   the frames; if the live runtime program differs, decoding old frames as the
//   new program's answer would be silent garbage — refuse loudly. A header md5
//   of all '?' means the plugin couldn't obtain it: degrade (decode anyway,
//   programMd5Verified=false + note), it is NOT a version mismatch.
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { io } from 'socket.io-client'
import { readState } from '../state.js'
import { safePath } from '../pathSafety.js'
import { decodeValue } from '../client/variables.js'
import { fetchRecording } from '../client/record.js'
import { RuntimeClient } from '../client/runtime.js'
import { buildNameSuggestions } from './readVariables.js'
import type { RecordInput, RecordResult, RecordSeries, VariableEntry } from '../types.js'
import type { PlcConfig } from '../config.js'

const TRANSITION_CAP = 50
const DEFAULT_LAST_SCANS = 250
const MAX_FRAMES = 4000   // recorder ring capacity — one fetch drains it all

type SeriesValue = number | boolean | string

// NaN-aware value-change test.  Strict !== treats NaN !== NaN as true, causing
// every consecutive NaN frame to look like a transition — spurious transitions
// fill the cap and summary.min/max become NaN.  Two NaN values are NOT a change.
const changed = (a: unknown, b: unknown): boolean =>
  (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b))
    ? false : a !== b

// Fetch the LIVE program md5 via the 0x45 debug command. There is no existing
// client for 0x45, so this private helper mirrors readDebugSnapshot's socket
// skeleton. Command payload `45 DE AD 00 00` (endianness probe bytes ignored by
// the md5 handler); success response is [0x45, 0x7e, ...32 ascii md5 chars].
// 实测(2026-06-16 spike):返回的 md5 == md5(ST 源码字节),故部署后比对 md5(stCode)
// 即可硬验「runtime 加载的就是刚部署的程序」(压换载竞态)。verify parallel deploy 复用。
export async function fetchLiveMd5(baseUrl: string, token: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/api/debug`, {
      path: '/socket.io',
      transports: ['polling'],
      auth: { token },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    } as any)

    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error(`0x45 md5 read timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    let commandSent = false
    const sendCommand = () => {
      if (commandSent || !socket.connected) return
      commandSent = true
      socket.emit('debug_command', { command: '45 DE AD 00 00' })
    }
    socket.on('connected', sendCommand)
    socket.on('connect', () => setTimeout(sendCommand, 100))

    socket.on('debug_response', (data: { success?: boolean; data?: string; error?: string }) => {
      clearTimeout(timer)
      socket.disconnect()
      if (data.success === false) return reject(new Error(`0x45 failed: ${data.error ?? 'unknown'}`))
      const bytes = (data.data ?? '').trim().split(/\s+/).map(h => parseInt(h, 16))
      if (bytes.length < 34 || bytes[0] !== 0x45 || bytes[1] !== 0x7e) {
        return reject(new Error(`bad 0x45 response: ${(data.data ?? '').slice(0, 30)}`))
      }
      resolve(bytes.slice(2, 34).map(c => String.fromCharCode(c)).join(''))
    })

    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer)
      socket.disconnect()
      reject(new Error(`WebSocket connect failed: ${err.message}`))
    })
  })
}

function emptyResult(over: Partial<RecordResult>): RecordResult {
  return {
    success: false,
    window: null,
    series: [],
    unresolvedNames: [],
    skippedUnrecordable: [],
    fullDumpFile: null,
    programMd5Verified: false,
    errorMessage: null,
    ...over,
  }
}

export async function handleRecord(
  input: RecordInput,
  cfg: PlcConfig,
  fetchOverride?: typeof fetchRecording,
  gateOverride?: { md5Live?: string; transitionCap?: number },
): Promise<RecordResult> {
  // gate 1: varNames is mandatory — fail fast, before any fetch.
  if (!input.varNames || input.varNames.length === 0) {
    return emptyResult({
      errorMessage: 'varNames 必填——plc_record 禁止录全量返回(上下文防爆);请指定要解码的变量名列表',
    })
  }

  const state = readState(cfg.stateFile)
  if (!state.lastCompile?.variableMap?.length) {
    return emptyResult({
      unresolvedNames: input.varNames,
      errorMessage: 'No variable map found. Run plc.compile or plc.buildAndRun first.',
    })
  }
  const allVars = state.lastCompile.variableMap

  // Resolve names case-insensitively (matiec lowercases the variableMap).
  const targets: VariableEntry[] = []
  const unresolvedNames: string[] = []
  for (const name of input.varNames) {
    const lc = name.toLowerCase()
    const v = allVars.find(e => e.name.toLowerCase() === lc)
    if (v) targets.push(v)
    else unresolvedNames.push(name)
  }
  const suggestions = unresolvedNames.length > 0 ? buildNameSuggestions(unresolvedNames, allVars) : {}
  const withSuggestions = Object.keys(suggestions).length > 0 ? { nameSuggestions: suggestions } : {}

  if (targets.length === 0) {
    return emptyResult({
      success: true, unresolvedNames, ...withSuggestions,
      errorMessage: null,
    })
  }

  try {
    const fetchFn = fetchOverride ?? fetchRecording
    let token = ''
    if (!fetchOverride) {
      const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
      token = await client.getAuthToken()
    }

    // One fetch drains the ring (INFO + paged FETCH); the window is applied locally.
    const { header, frames } = await fetchFn(cfg.url, token, {
      fromTick: 0n, maxFrames: MAX_FRAMES, timeoutMs: input.timeoutMs,
    })

    // ── md5 gate ────────────────────────────────────────────────────────────
    let md5Live = gateOverride?.md5Live
    if (md5Live === undefined && !fetchOverride) {
      try { md5Live = await fetchLiveMd5(cfg.url, token) } catch { md5Live = undefined }
    }
    let programMd5Verified = false
    let note: string | undefined
    if (/^\?+$/.test(header.md5)) {
      // Plugin-side degradation: recorder couldn't obtain the program md5.
      // NOT a version mismatch — decode, but say the verification didn't happen.
      note = `录波头未携带程序 md5(插件侧拿不到,全'?')——版本未验证,数据按当前 variableMap 解码`
    } else if (md5Live === undefined) {
      note = `实时程序 md5 读取失败(0x45)——版本未验证,数据按当前 variableMap 解码`
    } else if (md5Live === header.md5) {
      programMd5Verified = true
    } else {
      return emptyResult({
        unresolvedNames, ...withSuggestions,
        errorMessage: `程序已变更，录波数据属于旧版本(record md5=${header.md5},live md5=${md5Live})——重新触发行为后再 record`,
      })
    }

    // Resolved-but-unrecordable (the recorder skips size-0 vars like STRING —
    // they have no slot in the header var table): fail-loud, never silent-drop.
    const headerVarByIdx = new Map(header.vars.map(v => [v.idx, v]))
    const skippedUnrecordable: string[] = []
    const recordable: Array<{ entry: VariableEntry; off: number; size: number }> = []
    for (const t of targets) {
      const hv = headerVarByIdx.get(t.index)
      if (hv) recordable.push({ entry: t, off: hv.off, size: hv.size })
      else skippedUnrecordable.push(t.name)
    }

    // ── window ──────────────────────────────────────────────────────────────
    if (frames.length === 0) {
      return emptyResult({
        success: true, unresolvedNames, ...withSuggestions, skippedUnrecordable,
        programMd5Verified,
        note: [note, '录波缓冲为空——recorder 可能刚 armed 或程序未运行'].filter(Boolean).join(';'),
        errorMessage: null,
      })
    }
    const maxTick = Number(frames[frames.length - 1].tick)
    // fromTick wins; otherwise a lastScans-sized window off the newest frame
    // (decimation widens the tick span each retained frame covers).
    const windowStart = input.fromTick
      ?? maxTick - (input.lastScans ?? DEFAULT_LAST_SCANS) * header.decimation + 1
    const winFrames = frames.filter(f => Number(f.tick) >= windowStart)
    if (winFrames.length === 0) {
      return emptyResult({
        success: true, unresolvedNames, ...withSuggestions, skippedUnrecordable,
        programMd5Verified,
        note: [note, `窗口内无帧(窗口起点 ${windowStart} > 最新帧 ${maxTick})`].filter(Boolean).join(';'),
        errorMessage: null,
      })
    }
    const fromTick = Number(winFrames[0].tick)
    const toTick = Number(winFrames[winFrames.length - 1].tick)
    // scanMs: the tool layer has no access to the runtime ticktime — honest null.
    const window = { fromTick, toTick, scanMs: null, decimation: header.decimation }

    // ── changes-only encoding + cap + summary ───────────────────────────────
    const cap = gateOverride?.transitionCap ?? TRANSITION_CAP
    const series: RecordSeries[] = []
    let anyTruncated = false
    const nanVarNames: string[] = []
    for (const { entry, off, size } of recordable) {
      const values: SeriesValue[] = winFrames.map(f => decodeValue(entry.type, f.slot.slice(off, off + size)))
      const first = values[0]
      const transitions: Array<[number, SeriesValue]> = []
      let prev = first
      for (let i = 1; i < values.length; i++) {
        // Use NaN-aware comparison: NaN→NaN is NOT a transition (strict !== would
        // treat it as one — causing every consecutive NaN frame to register as a
        // spurious change that fills the cap and turns summary.min/max into NaN).
        // BigInt-string types (LINT/ULINT/LWORD) are strings, so === still works.
        if (changed(values[i], prev)) transitions.push([Number(winFrames[i].tick), values[i]])
        prev = values[i]
      }
      // Detect NaN presence in any numeric sequence (REAL/LREAL decode to number).
      const hasNaN = values.some(v => typeof v === 'number' && Number.isNaN(v))
      if (hasNaN) nanVarNames.push(entry.name)

      const truncated = transitions.length > cap
      const s: RecordSeries = {
        name: entry.name, type: entry.type,
        first,
        transitions: truncated ? transitions.slice(0, cap) : transitions,
        truncated,
      }
      if (truncated) {
        anyTruncated = true
        const last = values[values.length - 1]
        if (values.every(v => typeof v === 'number')) {
          // Filter out NaN before aggregation — Math.min/max propagate NaN silently.
          const finiteNums = (values as number[]).filter(v => !Number.isNaN(v))
          if (finiteNums.length > 0) {
            const nums = values as number[]
            s.summary = {
              min: Math.min(...finiteNums),
              max: Math.max(...finiteNums),
              last,
              monotonic: nums.every((v, i) => i === 0 || Number.isNaN(v) || Number.isNaN(nums[i - 1]) || v >= nums[i - 1]),
            }
          } else {
            // All values are NaN — no meaningful min/max/monotonic
            s.summary = { last }
          }
        } else {
          // non-numeric (BOOL / BigInt-string): min/max/monotonic don't apply
          s.summary = { last }
        }
      }
      series.push(s)
    }

    // Fail-loud NaN notice: append to existing note (semicolon-separated).
    if (nanVarNames.length > 0) {
      const nanNote = nanVarNames.map(n => `序列 ${n} 含 NaN——浮点位型/除零可疑`).join(';')
      note = note ? `${note};${nanNote}` : nanNote
    }

    // ── full dump on truncation (gate 3) ────────────────────────────────────
    let fullDumpFile: string | null = null
    if (anyTruncated) {
      const dir = safePath(cfg.workspace ?? process.env.PLC_WORKSPACE ?? os.tmpdir())
      fullDumpFile = safePath(path.join(dir, `record-${fromTick}-${toTick}.json`), dir)
      // Full decode of EVERY recordable variable over the window — the complete
      // evidence lives on disk, never in the tool response.
      const allRecordable = allVars
        .map(v => ({ entry: v, hv: headerVarByIdx.get(v.index) }))
        .filter((x): x is { entry: VariableEntry; hv: { idx: number; off: number; size: number } } => x.hv != null)
      const dump = {
        window,
        programMd5Verified,
        frames: winFrames.map(f => ({
          tick: Number(f.tick),
          values: Object.fromEntries(allRecordable.map(({ entry, hv }) =>
            [entry.name, decodeValue(entry.type, f.slot.slice(hv.off, hv.off + hv.size))])),
        })),
      }
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fullDumpFile, JSON.stringify(dump, null, 2))
    }

    return {
      success: true,
      window,
      series,
      unresolvedNames,
      ...withSuggestions,
      skippedUnrecordable,
      fullDumpFile,
      programMd5Verified,
      ...(note ? { note } : {}),
      errorMessage: null,
    }
  } catch (e) {
    return emptyResult({
      unresolvedNames, ...withSuggestions,
      errorMessage: `Record failed: ${e instanceof Error ? e.message : String(e)}`,
    })
  }
}
