import { describe, it, expect } from 'vitest'
import { TOTAL_BUDGET_MS, CLEANUP_RESERVE_MS, BUILD_BUDGET_MS, estimateCaseMs, precheckBudget } from '../../src/verify/budget.js'

describe('budget constants (spec §5 — 必须 <120s run_shell 默认)', () => {
  it('total 100s, segments sum within total', () => {
    expect(TOTAL_BUDGET_MS).toBe(100_000)
    expect(BUILD_BUDGET_MS + CLEANUP_RESERVE_MS).toBeLessThan(TOTAL_BUDGET_MS)
  })
})
describe('estimateCaseMs', () => {
  it('trace = durationMs + 1s overhead;steady = settle + 2s/expect(现实值,非超时上限);sequence 按步累加;均被 perCase 截顶', () => {
    expect(estimateCaseMs({ name: 'n', type: 'trace', vars: ['s'], durationMs: 12_000, expectShape: [] } as any, 30_000)).toBe(13_000)
    expect(estimateCaseMs({ name: 'n', type: 'steady', set: { a: 1 }, settleMs: 2_000, expect: [{ var: 'b', op: '==', value: 1 }] } as any, 30_000)).toBe(4_000)
    expect(estimateCaseMs({ name: 'n', type: 'trace', vars: ['s'], durationMs: 90_000, expectShape: [] } as any, 30_000)).toBe(30_000)
  })
  it('现实估算消除假阳性:3 个 3-expect 的 steady 不再被误拒(旧 5s 估会判 45s 超 40s)', () => {
    const cases = Array.from({ length: 3 }, (_, i) => ({
      name: `c${i}`, type: 'steady', set: { a: 1 },
      expect: [{ var: 'x', op: '==', value: 1 }, { var: 'y', op: '==', value: 1 }, { var: 'z', op: '==', value: 1 }],
    }))
    // 现实估:3 × (3×2000) = 18000 < casesBudget(40000) → 放行
    const r = precheckBudget({ program: 'a.st', options: { perCaseBudgetMs: 30_000, stopAfter: true, failFast: false, skipBuild: false }, cases } as any)
    expect(r.ok).toBe(true)
  })
})
describe('precheckBudget', () => {
  it('rejects a plan whose hard-estimate exceeds the cases budget, with split suggestion', () => {
    const cases = Array.from({ length: 6 }, (_, i) => ({ name: `c${i}`, type: 'trace', vars: ['s'], durationMs: 12_000, expectShape: [] }))
    const r = precheckBudget({ program: 'a.st', options: { perCaseBudgetMs: 30_000, stopAfter: true, failFast: false, skipBuild: false }, cases } as any)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/拆分|skipBuild/)
    expect(r.message).toMatch(/stopAfter/)
  })
  it('skipBuild=true frees the build segment', () => {
    const cases = Array.from({ length: 5 }, (_, i) => ({ name: `c${i}`, type: 'trace', vars: ['s'], durationMs: 12_000, expectShape: [] }))
    const base = { program: 'a.st', cases } as any
    expect(precheckBudget({ ...base, options: { perCaseBudgetMs: 30_000, stopAfter: true, failFast: false, skipBuild: false } }).ok).toBe(false)
    expect(precheckBudget({ ...base, options: { perCaseBudgetMs: 30_000, stopAfter: false, failFast: false, skipBuild: true } }).ok).toBe(true)
  })
})
