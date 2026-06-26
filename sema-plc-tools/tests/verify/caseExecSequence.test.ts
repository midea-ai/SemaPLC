import { describe, it, expect, vi } from 'vitest'
import { runCase } from '../../src/verify/caseExec.js'
import { mkDeps } from './helpers.js'

const seq = { name: 'q', type: 'sequence', steps: [
  { set: { start: true }, waitFor: { var: 'running', op: '==', value: true } },
  { set: { item: true }, expect: [{ var: 'counter', op: '==', value: 1 }] },
] } as any

describe('runCase sequence', () => {
  it('全步通过 → ok;case 末统一 release 全部持有 force', async () => {
    const deps = mkDeps()
    const r = await runCase(seq, deps)
    expect(r.ok).toBe(true)
    expect(deps.force).toHaveBeenCalledWith({ release: ['start', 'item'] })
  })
  it('waitFor 步超时 → stage=caseSetup,detail 含 failedStep 与 heldForces', async () => {
    const deps = mkDeps({ waitFor: vi.fn(async () => ({ success: false, timedOut: true, finalValue: false, tick: 3, elapsedMs: 5000, polls: 25, errorMessage: null })) })
    const r = await runCase(seq, deps)
    expect(r.stage).toBe('caseSetup')
    expect(r.detail.failedStep).toBe(0)
    expect(r.detail.heldForces).toEqual(['start'])
    expect(deps.force).toHaveBeenCalledWith({ release: ['start'] })
  })
  it('expect 步失败 → stage=assert(waitFor 是推进,expect 才是断言)', async () => {
    const deps = mkDeps({ waitFor: vi.fn()
      .mockResolvedValueOnce({ success: true, timedOut: false, finalValue: true, tick: 1, elapsedMs: 5, polls: 1, errorMessage: null })
      .mockResolvedValue({ success: false, timedOut: true, finalValue: 0, tick: 2, elapsedMs: 5000, polls: 25, errorMessage: null }) })
    const r = await runCase(seq, deps)
    expect(r.stage).toBe('assert')
    expect(r.detail.failedStep).toBe(1)
  })
  it('步预算共享:预算耗尽 → reason=budget + skippedSteps=[1,2,3]', async () => {
    let t = 0
    const deps = mkDeps({ now: () => t, waitFor: vi.fn(async () => { t += 40_000
      return { success: true, timedOut: false, finalValue: true, tick: 1, elapsedMs: 40_000, polls: 1, errorMessage: null } }) })
    const r = await runCase({ ...seq, steps: [...seq.steps, ...seq.steps] }, { ...deps, budgetMs: 30_000 })
    expect(r.ok).toBe(false)
    expect(r.detail.reason).toBe('budget')
    expect(r.detail.skippedSteps).toEqual([1, 2, 3])
  })

  it('force 部分失败 → stage=caseSetup;finally 仍以 {release:[已尝试名]} 调用 force 且 unregisterForces 包含已尝试名', async () => {
    // 第 0 步 set:{start:true} force 部分失败:start 已 forced、x 失败
    const partialForceMock = vi.fn(async (input: any) => {
      if (input.release) return { success: true, forced: [], released: input.release, failed: [], errorMessage: null }
      return {
        success: false,
        forced: [{ name: 'start', index: 0, type: 'BOOL', value: true }],
        failed: [{ name: 'x', reason: 'unresolved' }],
        released: [],
        errorMessage: null,
      }
    })
    const caseWithPartialForce = {
      name: 'partial', type: 'sequence',
      steps: [{ set: { start: true, x: true } }],
    } as any
    const deps = mkDeps({ force: partialForceMock })
    const r = await runCase(caseWithPartialForce, deps)

    // 失败路径语义
    expect(r.ok).toBe(false)
    expect(r.stage).toBe('caseSetup')

    // "尝试即持有":finally 必须以 { release: ['start', 'x'] } 调用 force
    const releaseCalls = partialForceMock.mock.calls.filter((c: any[]) => c[0]?.release)
    expect(releaseCalls.length).toBe(1)
    expect(releaseCalls[0][0].release).toEqual(['start', 'x'])

    // unregisterForces 也需被调用,且包含两个已注册的名字
    expect(deps.unregisterForces).toHaveBeenCalledWith(expect.arrayContaining(['start', 'x']))
  })
})
