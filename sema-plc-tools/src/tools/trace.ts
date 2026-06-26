import { readState } from '../state.js'
import { readDebugSnapshot } from '../client/variables.js'
import { RuntimeClient } from '../client/runtime.js'
import { buildNameSuggestions } from './readVariables.js'
import { MCP_SAFE_MAX_MS } from '../mcpBudget.js'
import type { TraceInput, TraceResult, TraceSample, VariableEntry, VariableValue } from '../types.js'
import type { PlcConfig } from '../config.js'

const MAX_SAMPLES = 200

type SnapshotFn = (
  baseUrl: string,
  token: string,
  variables: VariableEntry[],
  timeoutMs?: number,
) => Promise<{ tick: number | null; values: Record<string, VariableValue> }>

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// Sample a set of variables over time so temporal behavior (timers, edge detection,
// state-machine rotation, counter monotonicity) can be verified — something a single
// plc_readVariables snapshot cannot do. Reuses the WebSocket debug read path and
// surfaces the runtime tick__ so samples can be ordered by real scan progression.
export async function handleTrace(
  input: TraceInput,
  cfg: PlcConfig,
  snapshotFnOverride?: SnapshotFn,
  maxWallMsOverride?: number,
): Promise<TraceResult> {
  const state = readState(cfg.stateFile)
  if (!state.lastCompile?.variableMap?.length) {
    return {
      success: false,
      columns: [], meta: {},
      samples: [],
      unresolvedNames: input.varNames ?? [],
      errorMessage: 'No variable map found. Run plc.compile or plc.buildAndRun first.',
    }
  }

  const allVars = state.lastCompile.variableMap
  const requestedNames = input.varNames

  let targetVars: VariableEntry[]
  const unresolvedNames: string[] = []
  if (requestedNames && requestedNames.length > 0) {
    targetVars = []
    for (const name of requestedNames) {
      // Case-insensitive (matches readVariables): matiec lowercases the variableMap.
      const lc = name.toLowerCase()
      const v = allVars.find(e => e.name.toLowerCase() === lc)
      if (v) targetVars.push(v)
      else unresolvedNames.push(name)
    }
  } else {
    targetVars = allVars
  }

  const suggestions = unresolvedNames.length > 0 ? buildNameSuggestions(unresolvedNames, allVars) : {}
  const withSuggestions = Object.keys(suggestions).length > 0 ? { nameSuggestions: suggestions } : {}

  if (targetVars.length === 0) {
    return { success: true, columns: [], meta: {}, samples: [], unresolvedNames, ...withSuggestions, errorMessage: null }
  }

  const columns = targetVars.map(v => v.name)
  const meta: Record<string, { type: string; index: number; location: string }> =
    Object.fromEntries(targetVars.map(v => [v.name, { type: v.type, index: v.index, location: v.location }]))

  const intervalMs = input.intervalMs && input.intervalMs > 0 ? input.intervalMs : 200
  const rawCount = input.samples ?? Math.floor((input.durationMs ?? 2000) / intervalMs) + 1
  const count = Math.max(1, Math.min(MAX_SAMPLES, rawCount))

  const perSampleTimeout = input.timeoutMs ?? 2000
  const maxWall = maxWallMsOverride ?? MCP_SAFE_MAX_MS

  try {
    const snapshotFn = snapshotFnOverride ?? readDebugSnapshot
    let token = ''
    if (!snapshotFnOverride) {
      const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
      token = await client.getAuthToken()
    }

    const start = Date.now()
    const samples: TraceSample[] = []
    let truncated = false
    for (let i = 0; i < count; i++) {
      if (Date.now() - start >= maxWall) { truncated = true; break }
      try {
        const { tick, values } = await snapshotFn(cfg.url, token, targetVars, perSampleTimeout)
        samples.push({ elapsedMs: Date.now() - start, tick, values: columns.map(n => values[n]?.value ?? null) })
      } catch {
        // fail-soft: a single slow/failed read shouldn't abort the whole trace
        samples.push({ elapsedMs: Date.now() - start, tick: null, values: [] })
      }
      if (i < count - 1) await sleep(intervalMs)
    }
    const allFailed = samples.length > 0 && samples.every(s => s.tick === null)

    // Honest resolution: a sample costs a full debug round trip (~50ms floor), so
    // the achieved period is intervalMs + read latency. When the request was below
    // what we achieved, say so and point at the tools that DO catch transients
    // (the ws-3 pivot: persistent-downstream assertion / tick-verified pulse).
    const actualIntervalMs = samples.length >= 2
      ? Math.round((samples[samples.length - 1].elapsedMs - samples[0].elapsedMs) / (samples.length - 1))
      : undefined
    const subFloor = actualIntervalMs != null && intervalMs < 100 && actualIntervalMs > intervalMs * 1.5
      ? `实际平均采样周期 ~${actualIntervalMs}ms(单次读取是一次完整 debug 往返,请求的 ${intervalMs}ms 达不到);寿命短于 ~${actualIntervalMs}ms 的瞬态本 trace 必然漏采——验证边沿/瞬态改用 plc_verifyBehavior(持久下游断言)或 plc_forceVariables 的 pulseScans(tick 验证脉冲)`
      : undefined

    const notes = [
      truncated ? `已采 ${samples.length}/${count} 个样本后达 MCP 时长上限(${maxWall}ms)截断` : undefined,
      allFailed ? `所有 ${samples.length} 个样本读取均失败(tick:null)——debug socket 可能未就绪` : undefined,
      subFloor,
    ].filter(Boolean)
    const note = notes.length ? notes.join(';') : undefined
    return {
      success: true, columns, meta, samples, unresolvedNames, ...withSuggestions,
      ...(actualIntervalMs != null ? { actualIntervalMs } : {}),
      ...(note ? { note } : {}), errorMessage: null,
    }
  } catch (e) {
    return {
      success: false,
      columns: [], meta: {},
      samples: [],
      unresolvedNames,
      ...withSuggestions,
      errorMessage: `Trace failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
