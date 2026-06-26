import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path'
import { runVerifyParallel, type ParallelRunnerDeps } from '../../src/verify/runner.js'
import type { Instance } from '../../src/verify/pool.js'

const VMAP = [
  { index: 0, name: 'a', type: 'BOOL', location: '%IX0.0' },
  { index: 1, name: 'b', type: 'BOOL', location: '%QX0.0' },
]
const fakeInst = (id: number): Instance => ({ id, cfg: {} as any, client: {} as any })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function setupWs(caseNames: string[]): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-par-'))
  fs.mkdirSync(path.join(ws, 'src/programs'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'src/programs/a.st'), 'PROGRAM main END_PROGRAM')
  fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({
    program: 'src/programs/a.st',
    cases: caseNames.map(n => ({ name: n, type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] })),
  }))
  return ws
}

function okDeps(nInst: number, over: Partial<ParallelRunnerDeps> = {}): ParallelRunnerDeps {
  return {
    instances: Array.from({ length: nInst }, (_, k) => fakeInst(k + 1)),
    status: vi.fn(async () => ({ status: 'STOPPED', isRunning: false, runtimeReachable: true } as any)),
    compileOnce: vi.fn(async () => ({ ok: true, zipBuffer: Buffer.from('zip') })),
    deploy: vi.fn(async () => ({ ok: true })),
    runCase: vi.fn(async (c: any) => ({ name: c.name, ok: true, ms: 5, stage: null, detail: {}, hints: [] })),
    releaseResidual: vi.fn(async () => ({ released: [], releaseFailed: [] })),
    stop: vi.fn(async () => ({ success: true, requestedStatus: 'STOPPED', actualStatus: 'STOPPED', message: '' } as any)),
    detectIO: vi.fn(() => ({ io: [{ name: 'a', address: '%IX0.0', type: 'BOOL', direction: 'input', modbusType: null, modbusAddr: null }], count: 1 } as any)),
    readVariableMap: vi.fn(() => VMAP as any),
    now: () => Date.now(),
    ...over,
  }
}

describe('runVerifyParallel', () => {
  it('happy: 多工况并行全通过 → ok, latest.json ok, lock 清除', async () => {
    const ws = setupWs(['c1', 'c2', 'c3'])
    const deps = okDeps(2)
    const { envelope, exitCode } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.ok).toBe(true); expect(exitCode).toBe(0)
    expect(envelope.summary).toContain('3/3')
    expect(JSON.parse(fs.readFileSync(path.join(ws, '.plc-act/latest.json'), 'utf8')).ok).toBe(true)
    expect(fs.existsSync(path.join(ws, '.plc-act/running.lock'))).toBe(false)
    expect(deps.compileOnce).toHaveBeenCalledTimes(1)   // 编译只一次
  })

  it('(a) 首失败按 plan 声明序——即便后序 case 先完成', async () => {
    const ws = setupWs(['c1', 'c2', 'c3'])
    // c1 慢失败、c3 快失败:完成序是 c3 先于 c1;但首失败必须报 c1(声明序)
    const deps = okDeps(2, {
      runCase: vi.fn(async (c: any) => {
        if (c.name === 'c1') { await sleep(25); return { name: c.name, ok: false, ms: 5, stage: 'assert', detail: {}, hints: [] } }
        if (c.name === 'c3') return { name: c.name, ok: false, ms: 5, stage: 'assert', detail: {}, hints: [] }
        return { name: c.name, ok: true, ms: 5, stage: null, detail: {}, hints: [] }
      }),
    })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.ok).toBe(false)
    expect(envelope.summary).toContain("'c1' 失败")     // 声明序首失败 = c1,非完成序的 c3
    expect((envelope.failure!.detail as any).others?.[0]?.name).toBe('c3')
  })

  it('(b) deadline 命中 → 余下 case 显式 skipped + fail(timeout),不漏判', async () => {
    const ws = setupWs(['c1', 'c2', 'c3'])
    let clock = 0
    const deps = okDeps(1, {                              // 单实例,clock 可控
      now: () => clock,
      runCase: vi.fn(async (c: any) => { clock += 50_000; return { name: c.name, ok: true, ms: 5, stage: null, detail: {}, hints: [] } }),
    })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure!.stage).toBe('timeout')
    expect(envelope.ok).toBe(false)
    expect(envelope.summary).toContain('跳过')
    const skipped = envelope.steps.filter(s => (s as any).skipped).map(s => s.name)
    expect(skipped).toEqual(['case:c3'])                 // c1/c2 跑,c3 skipped
  })

  it('(c) 全实例不健康(连接错)→ fail(runtime),绝不误判 ok=true', async () => {
    const ws = setupWs(['c1', 'c2'])
    const deps = okDeps(1, {
      runCase: vi.fn(async (c: any) => ({ name: c.name, ok: false, ms: 5, stage: 'caseSetup', detail: { error: 'ECONNREFUSED' }, hints: [] })),
    })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.ok).toBe(false)
    expect(envelope.failure!.stage).toBe('runtime')
  })

  it('(d) 部分部署失败 → 回滚 stop 未部署实例,用剩余实例继续', async () => {
    const ws = setupWs(['c1', 'c2'])
    const stoppedIds: number[] = []
    const deps = okDeps(2, {
      deploy: vi.fn(async (_co, inst: Instance) => inst.id === 2 ? { ok: false, failStage: 'gcc' } : { ok: true }),
      stop: vi.fn(async (inst: Instance) => { stoppedIds.push(inst.id); return { success: true, requestedStatus: 'STOPPED', actualStatus: 'STOPPED', message: '' } as any }),
    })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(stoppedIds).toContain(2)                      // 回滚 stop 了未部署的 #2
    expect(envelope.ok).toBe(true)                       // 用 #1 跑完 2 工况
    expect(envelope.summary).toContain('2/2')
  })

  it('(e) 全部部署失败 → fail(gcc),不跑 case', async () => {
    const ws = setupWs(['c1', 'c2'])
    const deps = okDeps(2, { deploy: vi.fn(async () => ({ ok: false, failStage: 'gcc' })) })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.ok).toBe(false)
    expect(envelope.failure!.stage).toBe('gcc')
    expect(deps.runCase).not.toHaveBeenCalled()
  })

  it('(h) 实例中途死亡(连接错)→ 其 case 重派到健康实例并成功', async () => {
    const ws = setupWs(['c1', 'c2'])
    // 实例 #2 一律连接错(模拟容器挂),#1 正常 → 落 #2 的 case 应被重派到 #1
    const deps = okDeps(2, {
      runCase: vi.fn(async (c: any, _b: any, inst: Instance) =>
        inst.id === 2
          ? { name: c.name, ok: false, ms: 1, stage: 'caseSetup', detail: { error: 'ECONNREFUSED' }, hints: [] }
          : { name: c.name, ok: true, ms: 1, stage: null, detail: {}, hints: [] }),
    })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.ok).toBe(true)                              // 重派后两 case 都过
    expect(envelope.summary).toContain('2/2')
    expect(envelope.steps.some(s => s.name.startsWith('redispatch'))).toBe(true)
    expect((deps.runCase as any).mock.calls.length).toBeGreaterThan(2)  // 有重跑
  })

  it('(g) 部署全部 md5 不符 → fail(version-conflict),不跑 case', async () => {
    const ws = setupWs(['c1', 'c2'])
    const deps = okDeps(2, { deploy: vi.fn(async () => ({ ok: false, failStage: 'version-conflict' })) })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.ok).toBe(false)
    expect(envelope.failure!.stage).toBe('version-conflict')
    expect(deps.runCase).not.toHaveBeenCalled()
  })

  it('(f) 无可达实例 → fail(runtime)', async () => {
    const ws = setupWs(['c1'])
    const deps = okDeps(2, { status: vi.fn(async () => ({ status: 'STOPPED', isRunning: false, runtimeReachable: false } as any)) })
    const { envelope } = await runVerifyParallel(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure!.stage).toBe('runtime')
    expect(deps.compileOnce).not.toHaveBeenCalled()
  })
})
