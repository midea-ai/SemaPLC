import { describe, it, expect, vi } from 'vitest'
import { runCase } from '../../src/verify/caseExec.js'
import { mkDeps } from './helpers.js'

describe('runCase trace', () => {
  const traceCase = { name: 't', type: 'trace', vars: ['state'], durationMs: 2000,
    expectShape: [{ var: 'state', kind: 'cycle', sequence: [0, 1, 2] }] } as any
  it('shapes 全过 → ok;不过 → stage=assert 且 observed 进 detail', async () => {
    const cyc = mkDeps({ trace: vi.fn(async () => ({ success: true, columns: ['state'], meta: {},
      samples: [0,0,1,1,2,2,0].map((v, i) => ({ elapsedMs: i * 200, tick: i, values: [v] })), unresolvedNames: [], errorMessage: null })) })
    expect((await runCase(traceCase, cyc)).ok).toBe(true)

    const flat = mkDeps({ trace: vi.fn(async () => ({ success: true, columns: ['state'], meta: {},
      samples: [0,0,0,0].map((v, i) => ({ elapsedMs: i * 200, tick: i, values: [v] })), unresolvedNames: [], errorMessage: null })) })
    const r = await runCase(traceCase, flat)
    expect(r.ok).toBe(false); expect(r.stage).toBe('assert')
    expect(JSON.stringify(r.detail)).toMatch(/轮转|cycle/)
  })
  it('带 set 时:trace 前 force、结束必 release(异常路径也释放)', async () => {
    const deps = mkDeps({ trace: vi.fn(async () => { throw new Error('socket down') }) })
    const r = await runCase({ ...traceCase, set: { btn: true } }, deps)
    expect(r.stage).toBe('caseSetup')
    expect(deps.force).toHaveBeenCalledWith({ release: ['btn'] })
  })
  it('trace 整体读失败(全 null tick)→ caseSetup 而非 assert', async () => {
    const deps = mkDeps({ trace: vi.fn(async () => ({ success: true, columns: ['state'], meta: {},
      samples: [{ elapsedMs: 0, tick: null, values: [] }], unresolvedNames: [], errorMessage: null })) })
    expect((await runCase(traceCase, deps)).stage).toBe('caseSetup')
  })
})
describe('runCase record', () => {
  it('record series 还原成样本序列后过 shapes;skippedUnrecordable 进 detail', async () => {
    const c = { name: 'r', type: 'record', vars: ['reg'], lastScans: 50,
      expectShape: [{ var: 'reg', kind: 'changed' }] } as any
    const deps = mkDeps({ record: vi.fn(async () => ({ success: true,
      window: { fromTick: 0, toTick: 50, scanMs: 20, decimation: 1 },
      series: [{ name: 'reg', type: 'INT', first: 0, transitions: [[10, 1], [20, 3]], truncated: false }],
      unresolvedNames: [], skippedUnrecordable: [], fullDumpFile: null, programMd5Verified: true, errorMessage: null })) })
    expect((await runCase(c, deps)).ok).toBe(true)
  })
})

describe('runCase trace — 新增回归', () => {
  const traceCase = { name: 't', type: 'trace', vars: ['state'], durationMs: 2000,
    expectShape: [{ var: 'state', kind: 'cycle', sequence: [0, 1, 2] }] } as any

  it('force throw → 不向外抛(返回 caseSetup)、unregisterForces 被调用', async () => {
    const deps = mkDeps({ force: vi.fn(async () => { throw new Error('net') }) })
    const r = await runCase({ ...traceCase, set: { btn: true } }, deps)
    expect(r.stage).toBe('caseSetup')
    expect(deps.unregisterForces).toHaveBeenCalledWith(['btn'])
  })

  it('trace 返回 unresolvedNames → stage=caseSetup', async () => {
    const deps = mkDeps({ trace: vi.fn(async () => ({ success: true,
      columns: [],                   // 变量解析失败,columns 为空
      meta: {},
      samples: [{ elapsedMs: 0, tick: 1, values: [] }],
      unresolvedNames: ['stat'],
      nameSuggestions: ['state'],
      errorMessage: null })) })
    const r = await runCase(traceCase, deps)
    expect(r.stage).toBe('caseSetup')
    expect((r.detail as any).unresolvedNames).toContain('stat')
  })

  it('cycle 死值(折叠后 < 2)→ hints 含"状态机未运动"或"折叠后"字样', async () => {
    // flat fixture 与原测试 1 相同,[0,0,0,0] 折叠后 = [0],observed.length=1
    const flat = mkDeps({ trace: vi.fn(async () => ({ success: true, columns: ['state'], meta: {},
      samples: [0, 0, 0, 0].map((v, i) => ({ elapsedMs: i * 200, tick: i, values: [v] })),
      unresolvedNames: [], errorMessage: null })) })
    const r = await runCase(traceCase, flat)
    // 仍是 assert 失败(变量名正常解析)
    expect(r.stage).toBe('assert')
    const hintsStr = r.hints.join('\n')
    expect(hintsStr).toMatch(/状态机未运动|折叠后/)
  })
})

describe('runCase trace — stateTrace 补全量内部状态', () => {
  const tc = { name: 't', type: 'trace', vars: ['motor'], durationMs: 2000,
    expectShape: [{ var: 'motor', kind: 'cycle', sequence: [0, 1, 2] }] } as any
  it('cycle 失败时 stateTrace 含 trace 没采的内部变量(shift_reg)', async () => {
    let call = 0
    const deps = mkDeps({ trace: vi.fn(async () => {
      call++
      if (call === 1) return { success: true, columns: ['motor'], meta: {},
        samples: [0,0,0].map((v,i)=>({elapsedMs:i*200,tick:i,values:[v]})), unresolvedNames: [], errorMessage: null }
      // 第二次(snapshotFull)= 全量,含 shift_reg 在动
      return { success: true, columns: ['motor','shift_reg'], meta: {},
        samples: [[0,0],[0,1],[0,2]].map((v,i)=>({elapsedMs:i*200,tick:i,values:v})), unresolvedNames: [], errorMessage: null }
    }) })
    const r = await runCase(tc, deps)
    expect(r.stage).toBe('assert')
    expect(r.stateTrace ?? '').toMatch(/shift_reg/)
  })
})
