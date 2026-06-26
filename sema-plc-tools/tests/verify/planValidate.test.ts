import { describe, it, expect } from 'vitest'
import { normalizeAndValidate } from '../../src/verify/planParse.js'

const okCase = { name: 'n', type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] }

describe('normalizeAndValidate', () => {
  it('coerces string numbers/booleans (实证 ×16 的弱模型错型)', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'steady', set: { a: 'true', sp: '42' }, expect: [{ var: 'b', op: '==', value: '5' }] },
    ] })
    expect(errors).toEqual([])
    expect((plan!.cases[0] as any).set).toEqual({ a: true, sp: 42 })
    expect((plan!.cases[0] as any).expect[0].value).toBe(5)
  })
  it('converts legacy expectations map form ({x_min:5, y:true})', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'steady', set: { a: true }, expectations: { count_min: 5, led: true } },
    ] })
    expect(errors).toEqual([])
    expect((plan!.cases[0] as any).expect).toEqual([
      { var: 'count', op: '>=', value: 5 },
      { var: 'led', op: '==', value: true },
    ])
  })
  it('collects ALL errors with json-path + did-you-mean, not just the first', () => {
    const { errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'a', type: 'steady', sett: { x: 1 }, expect: [{ var: 'b', opp: '==', value: 1 }] },
      { name: 'b', type: 'trase', vars: ['s'], durationMs: 100, expectShape: [] },
    ] })
    const msgs = errors.map(e => `${e.path} ${e.message} ${e.suggestion ?? ''}`).join('\n')
    expect(errors.length).toBeGreaterThanOrEqual(3)
    expect(msgs).toMatch(/cases\[0\].*sett.*set/)
    expect(msgs).toMatch(/cases\[0\].expect\[0\].*opp/)
    expect(msgs).toMatch(/cases\[1\].*trase.*trace/)
  })
  it('rejects unknown shape kind / missing range bounds', () => {
    const { errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'trace', vars: ['s'], durationMs: 100,
        expectShape: [{ var: 's', kind: 'osc' }, { var: 's', kind: 'range' }] },
    ] })
    expect(errors.some(e => e.path.includes('expectShape[0]') && /cycle|range|settle|changed/.test(e.message))).toBe(true)
    expect(errors.some(e => e.path.includes('expectShape[1]') && /min.*max/.test(e.message))).toBe(true)
  })
  it('passes a fully valid plan and fills defaults', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [okCase] })
    expect(errors).toEqual([])
    expect(plan!.options).toEqual({ perCaseBudgetMs: 30_000, stopAfter: true, failFast: false, skipBuild: false, serial: false })
  })

  // ── coerce 写回回归 ──────────────────────────────────────────────────────────

  it('trace set 字符串归一化后写回(coerce 写回 bug 修复)', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'trace', vars: ['s'], durationMs: 100,
        set: { a: 'true' },
        expectShape: [{ var: 's', kind: 'changed' }] },
    ] })
    expect(errors).toEqual([])
    expect((plan!.cases[0] as any).set).toEqual({ a: true })
  })

  it('sequence step.set 字符串归一化后写回(coerce 写回 bug 修复)', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'sequence', steps: [
        { set: { a: '5' }, expect: [{ var: 'b', op: '==', value: 1 }] },
      ] },
    ] })
    expect(errors).toEqual([])
    expect((plan!.cases[0] as any).steps[0].set).toEqual({ a: 5 })
  })

  it('steady when.value 字符串归一化后写回(coerce 写回 bug 修复)', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'steady', set: { a: true },
        expect: [{ var: 'b', op: '==', value: 1 }],
        when: { var: 'p', op: '>=', value: '80' } },
    ] })
    expect(errors).toEqual([])
    expect((plan!.cases[0] as any).when).toEqual({ var: 'p', op: '>=', value: 80 })
  })

  // ── set 必填 ────────────────────────────────────────────────────────────────

  it('steady 有 expectations 但缺 set → 报错(set 必填 spec 修复)', () => {
    const { errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'steady', expectations: { led: true } },
    ] })
    expect(errors.some(e => e.path === 'cases[0].set')).toBe(true)
  })

  // ── expectShape 非空强制 ─────────────────────────────────────────────────────

  it('record 缺 expectShape → 报错', () => {
    const { errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'record', vars: ['s'] },
    ] })
    expect(errors.some(e => e.path === 'cases[0].expectShape')).toBe(true)
  })

  it('trace expectShape 为空数组 → 报错', () => {
    const { errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'trace', vars: ['s'], durationMs: 100, expectShape: [] },
    ] })
    expect(errors.some(e => e.path === 'cases[0].expectShape')).toBe(true)
  })
})

describe('cycle sequence uniqueness gate', () => {
  it('rejects duplicate elements in cycle sequence (shapes findIndex would misjudge silently)', () => {
    const { errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'n', type: 'trace', vars: ['s'], durationMs: 100,
        expectShape: [{ var: 's', kind: 'cycle', sequence: [0, 1, 0, 2] }] },
    ] })
    expect(errors.some(e => e.path.includes('expectShape[0]') && /互不重复/.test(e.message))).toBe(true)
  })
})

describe('timeoutMs passthrough (终审回归)', () => {
  it('when.timeoutMs and sequence waitFor.timeoutMs survive normalization', () => {
    const { plan, errors } = normalizeAndValidate({ program: 'a.st', cases: [
      { name: 'w', type: 'steady', set: { a: true }, when: { var: 'pos', op: '>=', value: 20, timeoutMs: 8000 },
        expect: [{ var: 'b', op: '==', value: true }] },
      { name: 's', type: 'sequence', steps: [
        { set: { x: true }, waitFor: { var: 'y', op: '==', value: true, timeoutMs: 3000 } } ] },
    ] })
    expect(errors).toEqual([])
    expect((plan!.cases[0] as any).when.timeoutMs).toBe(8000)
    expect((plan!.cases[1] as any).steps[0].waitFor.timeoutMs).toBe(3000)
  })
})
