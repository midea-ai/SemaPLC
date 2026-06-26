import { describe, it, expect } from 'vitest'
import { resolveInstances, runWithPool, type Instance } from '../../src/verify/pool.js'
import type { PlcConfig } from '../../src/config.js'

const baseCfg = (over: Partial<PlcConfig>): PlcConfig => ({
  url: 'https://localhost:8443', container: 'openplc-plc-dev', checkStdlibDir: '/x',
  user: 'admin', password: process.env.PLC_TEST_PW ?? 'admin123', stateFile: '/tmp/s.json', poolSize: 1, ...over,
})

// runWithPool 不碰 client,塞占位即可
const inst = (id: number): Instance => ({ id, cfg: baseCfg({}), client: {} as any })

describe('resolveInstances', () => {
  it('poolSize=3 → #1..#3,端口 8444/8445/8446,容器 openplc-plc-dev-N', () => {
    const got = resolveInstances(baseCfg({ poolSize: 3 }))
    expect(got.map(i => i.id)).toEqual([1, 2, 3])
    expect(got.map(i => i.cfg.url)).toEqual([
      'https://localhost:8444', 'https://localhost:8445', 'https://localhost:8446',
    ])
    expect(got.map(i => i.cfg.container)).toEqual([
      'openplc-plc-dev-1', 'openplc-plc-dev-2', 'openplc-plc-dev-3',
    ])
  })

  it('尊重 PLC_URL 的 host/basePort 覆盖', () => {
    const got = resolveInstances(baseCfg({ poolSize: 2, url: 'https://10.0.0.5:9000' }))
    expect(got.map(i => i.cfg.url)).toEqual(['https://10.0.0.5:9001', 'https://10.0.0.5:9002'])
  })
})

describe('runWithPool', () => {
  const noDeadline = { now: () => 0, deadline: () => 1e9, failFast: false, isHealthy: () => true }

  it('2 实例覆盖全部 items 恰好一次,结果按 items 序', async () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const byInst: Record<number, string[]> = { 1: [], 2: [] }
    const res = await runWithPool([inst(1), inst(2)], items,
      async (it, i) => { byInst[i.id].push(it); return it.toUpperCase() }, noDeadline)
    expect(res).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect([...byInst[1], ...byInst[2]].sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('单实例 = 串行(顺序消费)', async () => {
    const order: number[] = []
    const res = await runWithPool([inst(1)], [1, 2, 3],
      async (it) => { order.push(it); return it * 10 }, noDeadline)
    expect(order).toEqual([1, 2, 3])
    expect(res).toEqual([10, 20, 30])
  })

  it('deadline 命中后停取,余下留 undefined(skipped)', async () => {
    const nowSeq = [0, 0, 200, 200, 200]
    let ni = 0
    const handled: number[] = []
    const res = await runWithPool([inst(1)], [0, 1, 2, 3],
      async (it) => { handled.push(it); return `r${it}` },
      { now: () => nowSeq[Math.min(ni++, nowSeq.length - 1)], deadline: () => 100, failFast: false, isHealthy: () => true })
    expect(handled).toEqual([0, 1])
    expect(res).toEqual(['r0', 'r1', undefined, undefined])
  })

  it('不健康实例的 worker 退出(单实例不健康 → 一个都不取)', async () => {
    const handled: number[] = []
    const res = await runWithPool([inst(1)], [0, 1, 2],
      async (it) => { handled.push(it); return it }, { ...noDeadline, isHealthy: () => false })
    expect(handled).toEqual([])
    expect(res).toEqual([undefined, undefined, undefined])
  })

  it('failFast:失败后停取新活,余下 undefined', async () => {
    const handled: string[] = []
    const res = await runWithPool([inst(1)], ['ok', 'FAIL', 'c', 'd'],
      async (it) => { handled.push(it); return it },
      { ...noDeadline, failFast: true, isFailure: (r) => r === 'FAIL' })
    expect(handled).toEqual(['ok', 'FAIL'])
    expect(res).toEqual(['ok', 'FAIL', undefined, undefined])
  })

  it('failFast:飞行中的 case 不被丢弃(等其完成)', async () => {
    // inst1 拿 items[0]=FAIL,inst2 拿 items[1]=slow(在飞);FAIL 触发 failFast 后 slow 仍须完成
    let releaseSlow: () => void = () => {}
    const gate = new Promise<void>(r => { releaseSlow = r })
    const res = await runWithPool([inst(1), inst(2)], ['FAIL', 'slow', 'x', 'y'],
      async (it) => {
        if (it === 'FAIL') { releaseSlow(); return it }
        if (it === 'slow') { await gate; return it }
        return it
      },
      { ...noDeadline, failFast: true, isFailure: (r) => r === 'FAIL' })
    expect(res[0]).toBe('FAIL')
    expect(res[1]).toBe('slow')                  // 飞行中完成,未丢弃
    expect(res.slice(2)).toEqual([undefined, undefined])  // x/y 未取
  })
})
