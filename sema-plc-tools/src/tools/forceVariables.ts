const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

import { readState } from '../state.js'
import { forceVariableViaSocket, forceWhenViaSocket, serializeValue, varSize, isForceable, readDebugSnapshot } from '../client/variables.js'
import type { ForceWhenResult } from '../client/variables.js'
import { RuntimeClient } from '../client/runtime.js'
import type {
  ForceVariablesInput,
  ForceVariablesResult,
  ForcedItem,
  ForceFailure,
  PulseEvidence,
  WhenEvidence,
  VariableEntry,
} from '../types.js'
import type { PlcConfig } from '../config.js'

type ForceFn = (
  baseUrl: string,
  token: string,
  idx: number,
  flag: 0 | 1,
  valueBytes: number[],
  timeoutMs?: number,
) => Promise<string | null>

type SnapshotFn = (
  baseUrl: string,
  token: string,
  variables: VariableEntry[],
  timeoutMs?: number,
) => Promise<{ tick: number | null; values: Record<string, unknown> }>

type ForceWhenFn = (
  baseUrl: string,
  token: string,
  condVar: VariableEntry,
  op: string,
  target: number | boolean | string,
  sets: Array<{ idx: number; valueBytes: number[] }>,
  opts?: { timeoutMs?: number; pollMs?: number },
) => Promise<ForceWhenResult>

export async function handleForceVariables(
  input: ForceVariablesInput,
  cfg: PlcConfig,
  forceFnOverride?: ForceFn,
  snapshotFnOverride?: SnapshotFn,
  forceWhenFnOverride?: ForceWhenFn,
): Promise<ForceVariablesResult> {
  const state = readState(cfg.stateFile)
  if (!state.lastCompile?.variableMap?.length) {
    return {
      success: false,
      forced: [],
      released: [],
      failed: [],
      errorMessage: 'No variable map found. Run plc.compile first.',
    }
  }

  const set = input.set ?? {}
  const release = input.release ?? []
  const setNames = Object.keys(set)

  if (setNames.length === 0 && release.length === 0) {
    return { success: true, forced: [], released: [], failed: [], errorMessage: null }
  }

  const allVars = state.lastCompile.variableMap
  // Case-insensitive: matiec lowercases located names but the agent/scene use ST source
  // casing (e.g. sensor_color_A → runtime sensor_color_a). IEC 61131-3 identifiers are
  // case-insensitive, so this is correct, not just a workaround (no collision: matiec
  // already folds case to a unique lowercase name).
  const findVar = (name: string): VariableEntry | undefined => {
    const lower = name.toLowerCase()
    return allVars.find(v => v.name.toLowerCase() === lower)
  }

  // Resolve all names first; collect failures early to avoid wasted WebSocket trips.
  const setResolved: Array<{ name: string; entry: VariableEntry; valueBytes: number[]; coercedValue: number | boolean | string }> = []
  const releaseResolved: Array<{ name: string; entry: VariableEntry }> = []
  const failed: ForceFailure[] = []

  for (const name of setNames) {
    const entry = findVar(name)
    if (!entry) { failed.push({ name, reason: 'variable not found in variableMap' }); continue }
    const bytes = serializeValue(entry.type, set[name])
    if (!bytes) { failed.push({ name, reason: `cannot serialize value ${JSON.stringify(set[name])} as ${entry.type}` }); continue }
    // This runtime's force_var() silently no-ops unsupported (type, direction) combos —
    // it returns success but the value isn't latched. Reject up-front instead of pretending.
    if (!isForceable(entry.type, entry.location)) {
      failed.push({ name, reason: `${entry.type} at ${entry.location || 'internal'} is not forceable (only located %I/%Q vars of elementary types are forceable; internal/non-located vars are not)` })
      continue
    }
    setResolved.push({ name: entry.name, entry, valueBytes: bytes, coercedValue: set[name] })
  }

  for (const name of release) {
    const entry = findVar(name)
    if (!entry) { failed.push({ name, reason: 'variable not found in variableMap' }); continue }
    releaseResolved.push({ name: entry.name, entry })
  }

  // No actionable items? Return what we have.
  if (setResolved.length === 0 && releaseResolved.length === 0) {
    return { success: failed.length === 0, forced: [], released: [], failed, errorMessage: null }
  }

  // Resolve the when-condition variable BEFORE any network round trip (fail fast).
  let condEntry: VariableEntry | undefined
  if (input.when) {
    condEntry = findVar(input.when.varName)
    if (!condEntry) {
      failed.push({ name: input.when.varName, reason: 'when condition variable not found in variableMap' })
      return {
        success: false, forced: [], released: [], failed,
        errorMessage: `when 条件变量 ${input.when.varName} 不在 variableMap 中`,
      }
    }
  }

  // Acquire auth token once — only when some real network path will run.
  const forceFn = forceFnOverride ?? forceVariableViaSocket
  const whenFn = forceWhenFnOverride ?? forceWhenViaSocket
  const wantsPulse = (input.pulseScans != null && input.pulseScans > 0) || (input.pulseMs != null && input.pulseMs > 0)
  const needAuth =
    (input.when != null && !forceWhenFnOverride) ||
    (!forceFnOverride && (releaseResolved.length > 0 || (input.when == null && setResolved.length > 0) || (input.when != null && wantsPulse)))
  let token = ''
  if (needAuth) {
    try {
      const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
      token = await client.getAuthToken()
    } catch (e) {
      return {
        success: false,
        forced: [],
        released: [],
        failed,
        errorMessage: `Auth failed: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }

  const forced: ForcedItem[] = []
  const released: string[] = []
  let whenEv: WhenEvidence | undefined

  if (input.when && condEntry) {
    // Condition-triggered force: poll + fire over ONE persistent socket. The naive
    // waitFor→forceVariables pattern loses 3-5 scans to two connection handshakes;
    // here the force lands ~1 scan after the condition is observed (see gapScans).
    const r = await whenFn(
      cfg.url, token, condEntry, input.when.op, input.when.value,
      setResolved.map(s => ({ idx: s.entry.index, valueBytes: s.valueBytes })),
      { timeoutMs: input.when.timeoutMs, pollMs: input.when.pollMs },
    )
    whenEv = {
      met: r.met, polls: r.polls, conditionValue: r.conditionValue,
      tickAtMet: r.tickAtMet, tickAtForced: r.tickAtForced,
      gapScans: r.tickAtMet != null && r.tickAtForced != null ? r.tickAtForced - r.tickAtMet : null,
    }
    if (!r.met) {
      return {
        success: false, forced: [], released, failed, when: whenEv,
        errorMessage: `when 条件未在 ${input.when.timeoutMs ?? 5000}ms 内成立(${input.when.varName} ${input.when.op} ${JSON.stringify(input.when.value)},最后值=${JSON.stringify(r.conditionValue)},轮询 ${r.polls} 次)——未施加任何 force`,
      }
    }
    const errByIdx = new Map(r.forceErrors.map(e => [e.idx, e.error]))
    for (const item of setResolved) {
      const err = errByIdx.get(item.entry.index)
      if (err) failed.push({ name: item.name, reason: err })
      else forced.push({ name: item.name, index: item.entry.index, type: item.entry.type, value: item.coercedValue })
    }
  } else {
    // SET (force) operations
    for (const item of setResolved) {
      const err = await forceFn(cfg.url, token, item.entry.index, 1, item.valueBytes, input.timeoutMs ?? 5000)
      if (err) {
        failed.push({ name: item.name, reason: err })
      } else {
        forced.push({ name: item.name, index: item.entry.index, type: item.entry.type, value: item.coercedValue })
      }
    }
  }

  // RELEASE operations — protocol still expects a byte count + payload; send zero
  // bytes of the variable's correct size to keep the parser happy.
  for (const item of releaseResolved) {
    const size = varSize(item.entry.type)
    const zeros = new Array(size).fill(0)
    const err = await forceFn(cfg.url, token, item.entry.index, 0, zeros, input.timeoutMs ?? 5000)
    if (err) {
      failed.push({ name: item.name, reason: err })
    } else {
      released.push(item.name)
    }
  }

  // Pulse mode: auto-release all successfully forced variables, creating a clean
  // rising→falling edge for R_TRIG/F_TRIG edge detectors. Two flavors:
  // - pulseScans (preferred): hold until the runtime tick advanced ≥N scans, so the
  //   pulse is PROVEN to have been seen by the program. A blind wall-clock pulse can
  //   straddle zero scan boundaries and silently produce no edge (d9462cc9 forensics).
  // - pulseMs (legacy): wall-clock sleep; now also reports tick evidence when available.
  const wantScans = input.pulseScans != null && input.pulseScans > 0
    ? Math.min(50, Math.max(1, Math.floor(input.pulseScans)))
    : null
  const wantPulse = (wantScans != null || (input.pulseMs != null && input.pulseMs > 0)) && forced.length > 0
  let pulse: PulseEvidence | undefined

  if (wantPulse) {
    const snapshotFn = snapshotFnOverride ?? readDebugSnapshot
    // Probe via the first forced variable (the snapshot command needs ≥1 index).
    const probe = findVar(forced[0].name)!
    const readTick = async (): Promise<number | null> => {
      try { return (await snapshotFn(cfg.url, token, [probe], 2000)).tick } catch { return null }
    }

    const startTick = await readTick()
    let lastTick = startTick
    let verified = false
    let note: string | undefined

    if (wantScans != null) {
      const budget = input.timeoutMs ?? 5000
      const t0 = Date.now()
      if (startTick == null) {
        note = 'tick 不可读(debug socket 未就绪?)——无法验证脉冲被扫描到;已按 100ms 墙钟兜底'
        await sleep(100)
      } else {
        while (lastTick != null && lastTick - startTick < wantScans && Date.now() - t0 < budget) {
          await sleep(20)
          const t = await readTick()
          if (t != null) lastTick = t
        }
        verified = lastTick != null && lastTick - startTick >= wantScans
        if (!verified) {
          note = `tick 在 ${budget}ms 内未推进 ${wantScans} 个扫描周期(start=${startTick}, last=${lastTick})——PLC 可能未运行;已释放 force`
        }
      }
    } else {
      await sleep(input.pulseMs!)
      const t = await readTick()
      if (t != null) lastTick = t
      verified = startTick != null && lastTick != null && lastTick > startTick
      if (!verified) note = '无法证明程序在脉冲期间扫描过该值(tick 未推进或不可读)——边沿可能没有发生;改用 pulseScans 获得验证'
    }

    for (const item of forced) {
      const entry = findVar(item.name)
      if (!entry) continue
      const size = varSize(entry.type)
      const zeros = new Array(size).fill(0)
      const err = await forceFn(cfg.url, token, entry.index, 0, zeros, input.timeoutMs ?? 5000)
      if (err) {
        failed.push({ name: item.name, reason: `pulse release failed: ${err}` })
      } else {
        released.push(item.name)
      }
    }

    pulse = {
      startTick,
      releaseTick: lastTick,
      scansHeld: startTick != null && lastTick != null ? lastTick - startTick : null,
      verified,
      ...(note ? { note } : {}),
    }
  }

  return {
    success: failed.length === 0,
    forced,
    released,
    failed,
    ...(pulse ? { pulse } : {}),
    ...(whenEv ? { when: whenEv } : {}),
    errorMessage: null,
  }
}
