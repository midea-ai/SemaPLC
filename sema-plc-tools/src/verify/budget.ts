import type { VerifyPlan, PlanCase } from './planTypes.js'

// spec §5:总硬上限必须严格小于 run_shell 默认 120s(W3 下超时= SIGTERM kill,信封被吞)。
export const TOTAL_BUDGET_MS = 100_000
export const CLEANUP_RESERVE_MS = 15_000   // watchdog 触发点 = TOTAL - RESERVE;清理自身限时
export const BUILD_BUDGET_MS = 45_000      // buildAndRun 段(start fast-fail 后实测 P95 内)

// waitFor/expect 按现实返回时间估(实测中位 <1s,取 2s 留余量),而非超时上限 5s——
// 旧的 5s 估会把正常数量的 case 误判超预算(占 plan 失败 60%)。worst-case(waitFor
// 一直不成立、耗满超时)由 runner watchdog 兜底出 stage=timeout,预检不必保守。
const PER_EXPECT_MS = 2_000
// 仅 trace/record 计 overhead(采样建连);steady/sequence 的等待已由 settleMs/
// waitFor.timeoutMs 直接囊括,不叠加。pulseScans 步未计入(≤50 scans ≈ 3.5s 最坏,
// 由 CLEANUP_RESERVE 的 15s 余量吸收);record 估时假设窗口已就绪(读历史是单次调用)。
const CASE_OVERHEAD_MS = 1_000

export function estimateCaseMs(c: PlanCase, perCaseBudgetMs: number): number {
  let est: number
  switch (c.type) {
    case 'trace': est = CASE_OVERHEAD_MS + c.durationMs; break
    case 'record': est = CASE_OVERHEAD_MS + 3_000; break
    case 'steady': est = (c.settleMs ?? 0) + c.expect.length * PER_EXPECT_MS; break
    case 'sequence': {
      est = 0
      for (const s of c.steps) est += (s.settleMs ?? 0) + (s.waitFor ? (s.waitFor.timeoutMs ?? PER_EXPECT_MS) : 0) + (s.expect?.length ?? 0) * PER_EXPECT_MS
      break
    }
  }
  return Math.min(est, perCaseBudgetMs)
}

export function casesBudgetMs(skipBuild: boolean): number {
  return TOTAL_BUDGET_MS - CLEANUP_RESERVE_MS - (skipBuild ? 0 : BUILD_BUDGET_MS)
}

// poolSize 默认 1 = 串行(墙钟 = 求和,与今天逐字节等价);>1 = 并行墙钟 max(最长, ceil(和/池)).
export function precheckBudget(plan: VerifyPlan, poolSize = 1): { ok: boolean; estimateMs: number; message: string } {
  // 防御:plan 通常已经 normalizeAndValidate 填了默认 options,但本函数是独立导出。
  const opts = plan.options ?? {}
  const budget = casesBudgetMs(opts.skipBuild ?? false)
  if (plan.cases.length === 0) return { ok: true, estimateMs: 0, message: '' }   // 空 plan 守卫
  const ests = plan.cases.map(c => estimateCaseMs(c, opts.perCaseBudgetMs ?? 30_000))
  const sum = ests.reduce((s, e) => s + e, 0)
  const longest = Math.max(...ests)
  const estimateMs = Math.max(longest, Math.ceil(sum / poolSize))   // 墙钟;poolSize=1 → = sum
  if (estimateMs <= budget) return { ok: true, estimateMs, message: '' }
  const half = Math.ceil(plan.cases.length / 2)
  return {
    ok: false, estimateMs,
    message: `工况${poolSize > 1 ? `(并行 ${poolSize} 路)墙钟` : '总'}预估 ${Math.round(estimateMs / 1000)}s 超出预算 ${Math.round(budget / 1000)}s(waitFor 类按超时上限估,实际可能更快)。` +
      `请拆成两个 plan 分两次 verify:第一个含 cases[0..${half - 1}] 且 "stopAfter": false;` +
      `第二个含其余 case 且 "skipBuild": true(复用已在运行的程序,免重复编译)。`,
  }
}
