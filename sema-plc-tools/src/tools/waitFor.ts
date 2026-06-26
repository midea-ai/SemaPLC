import { readState } from '../state.js'
import { readDebugSnapshot } from '../client/variables.js'
import { RuntimeClient } from '../client/runtime.js'
import { buildNameSuggestions } from './readVariables.js'
import { clampToMcpBudget } from '../mcpBudget.js'
import type { WaitForInput, WaitForResult, VariableEntry, VariableValue } from '../types.js'
import type { PlcConfig } from '../config.js'

type SnapshotFn = (
  baseUrl: string,
  token: string,
  variables: VariableEntry[],
  timeoutMs?: number,
) => Promise<{ tick: number | null; values: Record<string, VariableValue> }>

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

type Scalar = number | boolean | string

export function looseEq(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b)
  if (typeof a === 'number' && typeof b === 'number') return a === b
  return String(a) === String(b)
}

export function compare(actual: Scalar, op: WaitForInput['op'], expected: Scalar): boolean {
  switch (op) {
    case '==': return looseEq(actual, expected)
    case '!=': return !looseEq(actual, expected)
    case '>': return Number(actual) > Number(expected)
    case '>=': return Number(actual) >= Number(expected)
    case '<': return Number(actual) < Number(expected)
    case '<=': return Number(actual) <= Number(expected)
  }
}

// Poll a single variable until it satisfies a comparison or the timeout elapses.
// Removes the hand-rolled poll loops the agent otherwise writes against single
// snapshots (which are fragile under WebSocket read jitter). Reuses readDebugSnapshot.
export async function handleWaitFor(
  input: WaitForInput,
  cfg: PlcConfig,
  snapshotFnOverride?: SnapshotFn,
  // Replaces the 50s MCP clamp as the cap on input.timeoutMs (two-way: can raise or
  // lower it). 0 means "time out immediately, zero polls" — don't pass 0 for "no limit".
  budgetOverrideMs?: number,
): Promise<WaitForResult> {
  const base: WaitForResult = {
    success: false, timedOut: false, finalValue: null, tick: null, elapsedMs: 0, polls: 0, errorMessage: null,
  }

  const state = readState(cfg.stateFile)
  if (!state.lastCompile?.variableMap?.length) {
    return { ...base, errorMessage: 'No variable map found. Run plc.compile or plc.buildAndRun first.' }
  }

  const allVars = state.lastCompile.variableMap
  // Case-insensitive: matiec lowercases names; IEC identifiers are case-insensitive
  // (matches readVariables/forceVariables — keeps force/wait/verify on one name policy).
  const lcName = input.varName.toLowerCase()
  const target = allVars.find(e => e.name.toLowerCase() === lcName)
  if (!target) {
    const sugg = buildNameSuggestions([input.varName], allVars)[input.varName]
    return {
      ...base,
      errorMessage: `Variable '${input.varName}' not found in variableMap.`,
      ...(sugg ? { nameSuggestion: sugg } : {}),
    }
  }

  const timeoutMs = budgetOverrideMs != null
    ? Math.min(input.timeoutMs ?? 5000, budgetOverrideMs)
    : clampToMcpBudget(input.timeoutMs, 5000)
  const intervalMs = input.intervalMs && input.intervalMs > 0 ? input.intervalMs : 200

  try {
    const snapshotFn = snapshotFnOverride ?? readDebugSnapshot
    let token = ''
    if (!snapshotFnOverride) {
      const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
      token = await client.getAuthToken()
    }

    const start = Date.now()
    let polls = 0
    let lastTick: number | null = null
    let lastValue: Scalar | null = null

    while (Date.now() - start < timeoutMs) {
      const { tick, values } = await snapshotFn(cfg.url, token, [target], 5000)
      polls++
      lastTick = tick
      const v = values[target.name]?.value
      if (v !== undefined) {
        lastValue = v
        if (compare(v, input.op, input.value)) {
          return { success: true, timedOut: false, finalValue: v, tick, elapsedMs: Date.now() - start, polls, errorMessage: null }
        }
      }
      if (Date.now() - start + intervalMs >= timeoutMs) break
      await sleep(intervalMs)
    }

    return { success: false, timedOut: true, finalValue: lastValue, tick: lastTick, elapsedMs: Date.now() - start, polls, errorMessage: null }
  } catch (e) {
    return { ...base, errorMessage: `waitFor failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
