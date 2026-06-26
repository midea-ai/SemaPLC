import { handleForceVariables } from './forceVariables.js'
import { handleWaitFor } from './waitFor.js'
import { MCP_SAFE_MAX_MS } from '../mcpBudget.js'
import type { PlcConfig } from '../config.js'
import type {
  VerifyBehaviorInput,
  VerifyBehaviorResult,
  VerifyExpectCondition,
  VerifyExpectResult,
  ForceVariablesInput,
  ForceVariablesResult,
  WaitForInput,
  WaitForResult,
} from '../types.js'

interface VerifyBehaviorDeps {
  force?: (input: ForceVariablesInput, cfg: PlcConfig) => Promise<ForceVariablesResult>
  waitFor?: (input: WaitForInput, cfg: PlcConfig) => Promise<WaitForResult>
  budgetMs?: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Atomically: force the given inputs → wait for downstream condition(s) within a timeout.
 *
 * Why this exists: a 1-scan-cycle (20ms) edge/transient can never be caught by a
 * separate force-then-read (40–300ms round-trip + the next-cycle force latency). The
 * ONLY reliable way to verify edge/fast logic is to assert its persistent downstream
 * effect (a pusher latches, a counter increments). This tool's SHAPE forces the caller
 * to declare that downstream condition — the "snapshot the transient" path doesn't exist.
 *
 * Scope: works for latch / level-holding downstream effects (the common case). For
 * single-stable / edge-reset downstream it can't help (same as the raw transient); for
 * edge-COUNT downstream a held force is one edge only — use ST self-drive or plc_trace.
 */
export async function handleVerifyBehavior(
  input: VerifyBehaviorInput,
  cfg: PlcConfig,
  deps: VerifyBehaviorDeps = {},
): Promise<VerifyBehaviorResult> {
  const force = deps.force ?? handleForceVariables
  const waitFor = deps.waitFor ?? handleWaitFor
  const releaseAfter = input.releaseAfter ?? true

  const isArray = Array.isArray(input.expect)
  const expects: VerifyExpectCondition[] = isArray ? input.expect as VerifyExpectCondition[] : [input.expect as VerifyExpectCondition]

  // 1. Force the inputs. If any input isn't forceable, fail BEFORE the wait — don't
  //    burn the full timeout waiting for a downstream effect that can never be driven.
  const fr = await force({ set: input.set }, cfg)
  if (!fr.success) {
    const emptyResult: VerifyExpectResult = { varName: '', matched: false, finalValue: null, timedOut: false, elapsedMs: 0, polls: 0, errorMessage: null }
    return {
      success: false,
      forced: fr.forced,
      forceFailed: fr.failed,
      expect: isArray ? expects.map((e) => ({ ...emptyResult, varName: e.varName })) : emptyResult,
      released: [],
      verdict: `✗ force 失败,未进入验证:${fr.failed.map((f) => `${f.name}(${f.reason})`).join('; ') || fr.errorMessage}`,
    }
  }

  // 2. (optional settle) → wait for each downstream condition. Always release in finally
  //    (default) so a held %I doesn't contaminate the next case's verification.
  const results: VerifyExpectResult[] = []
  let released: string[] = []
  try {
    // Clamp settle + wait so the whole call stays under the MCP request budget.
    const budget = deps.budgetMs ?? MCP_SAFE_MAX_MS
    const settleMs = Math.min(Math.max(input.settleMs ?? 0, 0), budget)
    if (settleMs > 0) await sleep(settleMs)
    const waitBudget = Math.max(1000, budget - settleMs)
    // Split the timeout budget across conditions.
    const perConditionBudget = Math.max(1000, Math.floor(waitBudget / expects.length))

    for (const cond of expects) {
      const timeoutMs = Math.min(cond.timeoutMs ?? 5000, perConditionBudget)
      const wr = await waitFor({ ...cond, timeoutMs }, cfg)
      results.push({
        varName: cond.varName,
        matched: wr.success,
        finalValue: wr.finalValue,
        timedOut: wr.timedOut,
        elapsedMs: wr.elapsedMs,
        polls: wr.polls,
        errorMessage: wr.errorMessage,
      })
    }
  } finally {
    if (releaseAfter) {
      const rr = await force({ release: Object.keys(input.set) }, cfg).catch(() => null)
      released = rr?.released ?? []
    }
  }

  const allMatched = results.every((r) => r.matched)

  // Build verdict
  let verdict: string
  const anyError = results.find((r) => r.errorMessage)
  if (anyError) {
    verdict = `✗ 等待出错:${anyError.errorMessage}`
  } else if (allMatched) {
    const maxMs = Math.max(...results.map((r) => r.elapsedMs))
    const condDesc = expects.map((e) => `${e.varName} ${e.op} ${e.value}`).join(' ∧ ')
    verdict = `✓ 行为验证通过:force ${JSON.stringify(input.set)} 后 ${condDesc} 在 ${maxMs}ms 内成立`
  } else {
    const failedConds = results
      .filter((r) => !r.matched)
      .map((r) => `${r.varName}(末值 ${r.finalValue})`)
      .join(', ')
    verdict = `✗ 下游未响应:${failedConds} 在超时内未成立。检查输入是否驱动到位 / 逻辑是否正确,边沿计数型下游别用 held-force 验`
  }

  return {
    success: allMatched,
    forced: fr.forced,
    forceFailed: fr.failed,
    expect: isArray ? results : results[0],
    released,
    verdict,
  }
}
