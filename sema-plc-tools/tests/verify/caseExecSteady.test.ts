import { describe, it, expect, vi } from 'vitest'
import { runCase } from '../../src/verify/caseExec.js'
import { mkDeps } from './helpers.js'

const steady = { name: 's', type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] } as any

describe('runCase steady', () => {
  it('plain steady → verifyBehavior;通过 → ok', async () => {
    const r = await runCase(steady, mkDeps())
    expect(r.ok).toBe(true); expect(r.stage).toBeNull()
  })
  it('force 失败 → stage=caseSetup,不进 assert', async () => {
    const deps = mkDeps({ verifyBehavior: vi.fn(async () => ({ success: false, forced: [],
      forceFailed: [{ name: 'a', reason: 'unresolved' }], expect: [], released: [], verdict: 'x' })) })
    const r = await runCase(steady, deps)
    expect(r.stage).toBe('caseSetup')
    expect(r.hints.join()).toMatch(/驱动|force/)
  })
  it('when 未触发 → stage=caseSetup + 明确提示"勿改程序"', async () => {
    const c = { ...steady, when: { var: 'pos', op: '>=', value: 80 } }
    const deps = mkDeps({ force: vi.fn(async () => ({ success: false, forced: [], released: [], failed: [],
      when: { met: false, polls: 9, conditionValue: 3, tickAtMet: null, tickAtForced: null, gapScans: null }, errorMessage: null })) })
    const r = await runCase(c, deps)
    expect(r.stage).toBe('caseSetup')
    expect(r.hints.join()).toMatch(/前置工况未成立/)
  })
  it('pulse 未 verified → caseSetup;assert 失败 → stage=assert 且附 lastFrames', async () => {
    const cPulse = { ...steady, pulseScans: 2 }
    const depsPulse = mkDeps({ force: vi.fn(async () => ({ success: true, forced: [{ name: 'a', index: 0, type: 'BOOL', value: true }],
      released: ['a'], failed: [], pulse: { startTick: 1, releaseTick: 1, scansHeld: 0, verified: false }, errorMessage: null })) })
    expect((await runCase(cPulse, depsPulse)).stage).toBe('caseSetup')

    const depsAssert = mkDeps({ verifyBehavior: vi.fn(async () => ({ success: false, forced: [], forceFailed: [],
      expect: [{ varName: 'b', matched: false, finalValue: false, timedOut: true, elapsedMs: 5000, polls: 25, errorMessage: null }],
      released: ['a'], verdict: 'x' })) })
    const r = await runCase(steady, depsAssert)
    expect(r.stage).toBe('assert')
    expect(r.lastFrames?.columns).toEqual(['b'])
  })
  it('污染预检:开跑前断言已成立 → hint 标注', async () => {
    const deps = mkDeps({ readVariables: vi.fn(async () => ({ success: true,
      variables: { b: { value: true, type: 'BOOL', index: 1, location: '%QX0.1' } }, unresolvedNames: [], errorMessage: null })) })
    const r = await runCase(steady, deps)
    expect(r.hints.join()).toMatch(/前序.*污染|已等于期望/)
  })

  it('大写 expect.var + readVariables 返回小写键已满足 → 污染 hint 出现', async () => {
    // expect.var = 'B'(大写),readVariables 返回小写键 'b'(matiec 行为)
    const c = { ...steady, expect: [{ var: 'B', op: '==', value: true }] } as any
    const deps = mkDeps({ readVariables: vi.fn(async () => ({ success: true,
      variables: { b: { value: true, type: 'BOOL', index: 1, location: '%QX0.1' } }, unresolvedNames: [], errorMessage: null })) })
    const r = await runCase(c, deps)
    expect(r.hints.join()).toMatch(/前序.*污染|已等于期望/)
  })

  it('when 路径:waitFor 返回 errorMessage → stage=caseSetup 且 detail 含 nameSuggestion', async () => {
    const c = { ...steady, when: { var: 'pos', op: '>=', value: 80, timeoutMs: 1000 } } as any
    const deps = mkDeps({
      force: vi.fn(async () => ({ success: true, forced: [{ name: 'a', index: 0, type: 'BOOL', value: true }],
        released: [], failed: [], when: { met: true, polls: 1, conditionValue: 80, tickAtMet: 5, tickAtForced: 5, gapScans: 0 }, errorMessage: null })),
      waitFor: vi.fn(async () => ({ success: false, timedOut: false, finalValue: null, tick: null,
        elapsedMs: 10, polls: 1, errorMessage: 'Variable not found', nameSuggestion: 'b' })),
    })
    const r = await runCase(c, deps)
    expect(r.stage).toBe('caseSetup')
    expect(r.detail.errorMessage).toBe('Variable not found')
    expect(r.detail.nameSuggestion).toBe('b')
    expect(r.hints.join()).toMatch(/变量名未解析|nameSuggestion/)
  })

  it('when 路径成功 → detail.expect 数组非空(含 tick/elapsedMs/polls 证据)', async () => {
    const c = { ...steady, when: { var: 'pos', op: '>=', value: 80, timeoutMs: 1000 } } as any
    const deps = mkDeps({
      force: vi.fn(async () => ({ success: true, forced: [{ name: 'a', index: 0, type: 'BOOL', value: true }],
        released: [], failed: [], when: { met: true, polls: 1, conditionValue: 80, tickAtMet: 5, tickAtForced: 5, gapScans: 0 }, errorMessage: null })),
      waitFor: vi.fn(async () => ({ success: true, timedOut: false, finalValue: true, tick: 5,
        elapsedMs: 10, polls: 1, errorMessage: null })),
    })
    const r = await runCase(c, deps)
    expect(r.ok).toBe(true)
    expect(r.stage).toBeNull()
    const expectArr = (r.detail as any).expect as any[]
    expect(Array.isArray(expectArr)).toBe(true)
    expect(expectArr.length).toBeGreaterThan(0)
    expect(expectArr[0]).toMatchObject({ success: true, tick: 5, elapsedMs: 10, polls: 1 })
  })
})

describe('runCase steady — 内部状态诊断(点1+点2)', () => {
  const failVB = () => vi.fn(async () => ({ success: false, forced: [], forceFailed: [],
    expect: [{ varName: 'b', matched: false, finalValue: false, timedOut: true, elapsedMs: 5000, polls: 25, errorMessage: null }],
    released: ['a'], verdict: 'x' }))
  it('内部有响应(state 0→1)但输出恒 false → hint 说"已消费/查内部→输出",不说"未消费";stateTrace 含 state', async () => {
    const deps = mkDeps({ verifyBehavior: failVB(),
      trace: vi.fn(async () => ({ success: true, columns: ['b', 'state'], meta: {}, samples: [
        { elapsedMs: 0, tick: 1, values: [false, 0] }, { elapsedMs: 200, tick: 2, values: [false, 1] },
      ], unresolvedNames: [], errorMessage: null })) })
    const r = await runCase(steady, deps)
    expect(r.stage).toBe('assert')
    expect(r.hints.join()).toMatch(/已.*消费|内部有响应/)
    expect(r.hints.join()).not.toMatch(/疑似程序未消费/)
    expect(r.stateTrace ?? '').toMatch(/state/)
  })
  it('全程无任何变量响应 → 保留"未消费/变量名错"', async () => {
    const deps = mkDeps({ verifyBehavior: failVB(),
      trace: vi.fn(async () => ({ success: true, columns: ['b'], meta: {}, samples: [
        { elapsedMs: 0, tick: 1, values: [false] }, { elapsedMs: 200, tick: 2, values: [false] },
      ], unresolvedNames: [], errorMessage: null })) })
    const r = await runCase(steady, deps)
    expect(r.hints.join()).toMatch(/未消费/)
  })
})
