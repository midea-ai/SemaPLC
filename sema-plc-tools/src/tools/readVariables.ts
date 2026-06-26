import { readState } from '../state.js'
import { readDebugSnapshot } from '../client/variables.js'
import { RuntimeClient } from '../client/runtime.js'
import type { ReadVariablesResult, VariableEntry, VariableValue } from '../types.js'
import type { PlcConfig } from '../config.js'

type ReadFn = (
  baseUrl: string,
  token: string,
  variables: VariableEntry[],
  timeoutMs?: number,
) => Promise<{ tick: number | null; values: Record<string, VariableValue> }>

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i)
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[a.length]
}

// For each unresolved name, suggest the closest variableMap name (case-insensitive
// exact match wins; otherwise nearest by edit distance within a small threshold).
// Debug names are lowercased and FB outputs carry an 'instance.port' prefix, so the
// dominant mismatch is letter case.
export function buildNameSuggestions(unresolved: string[], candidates: VariableEntry[]): Record<string, string> {
  const out: Record<string, string> = {}
  const names = candidates.map(c => c.name)
  for (const name of unresolved) {
    const lower = name.toLowerCase()
    const exact = names.find(n => n.toLowerCase() === lower)
    if (exact) {
      out[name] = exact
      continue
    }
    let best: string | undefined
    let bestDist = Infinity
    const limit = Math.max(2, Math.ceil(name.length / 3))
    for (const n of names) {
      const d = levenshtein(lower, n.toLowerCase())
      if (d < bestDist) {
        bestDist = d
        best = n
      }
    }
    if (best && bestDist <= limit) out[name] = best
  }
  return out
}

export async function handleReadVariables(
  input: { varNames?: string[]; timeoutMs?: number },
  cfg: PlcConfig,
  readFnOverride?: ReadFn,
): Promise<ReadVariablesResult> {
  const state = readState(cfg.stateFile)
  if (!state.lastCompile?.variableMap?.length) {
    return {
      success: false,
      variables: {},
      unresolvedNames: input.varNames ?? [],
      errorMessage: 'No variable map found. Run plc.compile first.',
    }
  }

  const allVars = state.lastCompile.variableMap
  const requestedNames = input.varNames

  let targetVars: VariableEntry[]
  let unresolvedNames: string[] = []

  if (requestedNames && requestedNames.length > 0) {
    targetVars = []
    for (const name of requestedNames) {
      // Case-insensitive: matiec lowercases names; IEC identifiers are case-insensitive.
      const lower = name.toLowerCase()
      const v = allVars.find(e => e.name.toLowerCase() === lower)
      if (v) targetVars.push(v)
      else unresolvedNames.push(name)
    }
  } else {
    targetVars = allVars
  }

  const suggestions = unresolvedNames.length > 0 ? buildNameSuggestions(unresolvedNames, allVars) : {}
  const withSuggestions = Object.keys(suggestions).length > 0 ? { nameSuggestions: suggestions } : {}

  if (targetVars.length === 0) {
    return { success: true, variables: {}, unresolvedNames, ...withSuggestions, errorMessage: null }
  }

  try {
    const readFn = readFnOverride ?? readDebugSnapshot
    let token = ''
    if (!readFnOverride) {
      const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
      token = await client.getAuthToken()
    }
    const { tick, values } = await readFn(cfg.url, token, targetVars, input.timeoutMs ?? 5000)
    return { success: true, variables: values, tick, unresolvedNames, ...withSuggestions, errorMessage: null }
  } catch (e) {
    return {
      success: false,
      variables: {},
      unresolvedNames,
      ...withSuggestions,
      errorMessage: `Variable read failed: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
