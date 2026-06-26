import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path'
import { runVerify } from '../../src/verify/runner.js'

function setupWs() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-runner-'))
  fs.mkdirSync(path.join(ws, 'src/programs'), { recursive: true })
  fs.writeFileSync(path.join(ws, 'src/programs/a.st'), 'PROGRAM main END_PROGRAM')
  fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({ program: 'src/programs/a.st', cases: [
    { name: 'c1', type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] } ] }))
  return ws
}
function okDeps(over: Partial<any> = {}) {
  return {
    status: vi.fn(async () => ({ status: 'STOPPED', isRunning: false, runtimeReachable: true })),
    buildAndRun: vi.fn(async () => ({ success: true, failedStage: null, compile: { success: true, variableMap: [
      { index: 0, name: 'a', type: 'BOOL', location: '%IX0.0' }, { index: 1, name: 'b', type: 'BOOL', location: '%QX0.0' }] },
      upload: null, start: null, finalStatus: 'RUNNING', agentSummary: 'ok' } as any)),
    runCase: vi.fn(async (c: any) => ({ name: c.name, ok: true, ms: 5, stage: null, detail: {}, hints: [] })),
    force: vi.fn(async () => ({ success: true, forced: [], released: ['a'], failed: [], errorMessage: null })),
    stop: vi.fn(async () => ({ success: true, requestedStatus: 'STOPPED', actualStatus: 'STOPPED', message: '' })),
    detectIO: vi.fn(() => ({ io: [{ name: 'a', address: '%IX0.0', type: 'BOOL', direction: 'input', modbusType: null, modbusAddr: null }], count: 1 })),
    readVariableMap: vi.fn(() => [{ index: 0, name: 'a', type: 'BOOL', location: '%IX0.0' }, { index: 1, name: 'b', type: 'BOOL', location: '%QX0.0' }]),
    readStateStCode: vi.fn(() => 'PROGRAM main END_PROGRAM'),
    now: () => Date.now(),
    ...over,
  } as any
}

describe('runVerify orchestration', () => {
  it('happy path: envelope ok, latest.json 写入, running.lock 清除, exitCode 0', async () => {
    const ws = setupWs()
    const { envelope, exitCode } = await runVerify(path.join(ws, 'plan.json'), ws, okDeps())
    expect(envelope.ok).toBe(true); expect(exitCode).toBe(0)
    const latest = JSON.parse(fs.readFileSync(path.join(ws, '.plc-act/latest.json'), 'utf8'))
    expect(latest.ok).toBe(true); expect(latest.stHash).toMatch(/^sha256:/)
    expect(fs.existsSync(path.join(ws, '.plc-act/running.lock'))).toBe(false)
    expect(envelope.artifacts.runDir).toBeTruthy()
    expect(fs.existsSync(path.join(ws, envelope.artifacts.runDir!, 'envelope.json'))).toBe(true)
  })
  it('amnesty:启动时 release 上次残留 active-forces.json', async () => {
    const ws = setupWs()
    fs.mkdirSync(path.join(ws, '.plc-act'), { recursive: true })
    fs.writeFileSync(path.join(ws, '.plc-act/active-forces.json'), JSON.stringify(['stale_a']))
    const deps = okDeps()
    await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(deps.force).toHaveBeenCalledWith({ release: ['stale_a'] })
  })
  it('plan 校验失败 → stage=plan,不 build 不跑 case,exitCode 仍 0', async () => {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), '{"program": "src/programs/a.st"}')
    const deps = okDeps()
    const { envelope, exitCode } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure?.stage).toBe('plan'); expect(exitCode).toBe(0)
    expect(deps.buildAndRun).not.toHaveBeenCalled()
  })
  it('compile 失败 → stage=compile,detail 透传 iec2c errors(advice/sourceLine)', async () => {
    const ws = setupWs()
    const deps = okDeps({ buildAndRun: vi.fn(async () => ({ success: false, failedStage: 'compile',
      compile: { success: false, iec2c: { errors: [{ line: 3, col: 1, message: 'syntax', severity: 'error', sourceLine: 'IF x', advice: '缺 END_IF;' }] }, errorSummary: 's' },
      upload: null, start: null, finalStatus: null, agentSummary: 'fail' } as any)) })
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure?.stage).toBe('compile')
    expect(JSON.stringify(envelope.failure?.detail)).toMatch(/END_IF/)
  })
  it('build 后变量名预检:expect 变量不在 variableMap → stage=plan + nameSuggestions', async () => {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({ program: 'src/programs/a.st', cases: [
      { name: 'c', type: 'steady', set: { a: true }, expect: [{ var: 'bb', op: '==', value: true }] } ] }))
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, okDeps())
    expect(envelope.failure?.stage).toBe('plan')
    expect(JSON.stringify(envelope.failure?.detail)).toMatch(/bb/)
  })
  it('skipBuild:state 的 stCode 与 .st 不一致 → stage=version-conflict', async () => {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({ program: 'src/programs/a.st',
      options: { skipBuild: true }, cases: [{ name: 'c', type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] }] }))
    const deps = okDeps({ readStateStCode: vi.fn(() => 'DIFFERENT') })
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure?.stage).toBe('version-conflict')
  })
  it('failFast=false 跑全部;连续 2 个 caseSetup 且连接类错误 → 升级 failFast', async () => {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({ program: 'src/programs/a.st', cases: [1, 2, 3].map(i => (
      { name: `c${i}`, type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] })) }))
    const deps = okDeps({ runCase: vi.fn(async (c: any) => ({ name: c.name, ok: false, ms: 5, stage: 'caseSetup',
      detail: { error: 'ECONNREFUSED' }, hints: [] })) })
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(deps.runCase.mock.calls.length).toBe(2)
    expect(envelope.steps.some(s => s.skipped)).toBe(true)
  })
  it('watchdog:case 耗尽预算 → 余 case skipped + stage=timeout', async () => {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({ program: 'src/programs/a.st', cases: [1, 2].map(i => (
      { name: `c${i}`, type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] })) }))
    let t = 0
    const deps = okDeps({ now: () => t, runCase: vi.fn(async (c: any) => { t += 90_000
      return { name: c.name, ok: true, ms: 90_000, stage: null, detail: {}, hints: [] } }) })
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure?.stage).toBe('timeout')
    expect(envelope.steps.filter(s => s.skipped).length).toBe(1)
  })

  it('exception 路径:status throw → stage=exception, exitCode=0, lock 不存在, summary 无裸 stack', async () => {
    const ws = setupWs()
    const deps = okDeps({ status: vi.fn(async () => { throw new Error('boom') }) })
    const { envelope, exitCode } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(envelope.failure?.stage).toBe('exception')
    expect(exitCode).toBe(0)
    expect(fs.existsSync(path.join(ws, '.plc-act/running.lock'))).toBe(false)
    // summary 不含裸 stack trace(不应有 ' at ')
    expect(envelope.summary).not.toMatch(/ at /)
  })

  it('显式 failFast=true:首 case 失败即跳过余 case,runCase 只调 1 次', async () => {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({
      program: 'src/programs/a.st',
      options: { failFast: true },
      cases: [1, 2, 3].map(i => ({ name: `c${i}`, type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] })),
    }))
    const deps = okDeps({
      runCase: vi.fn(async (c: any) => ({ name: c.name, ok: false, ms: 5, stage: 'assert', detail: {}, hints: [] })),
    })
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(deps.runCase.mock.calls.length).toBe(1)
    expect(envelope.steps.some(s => s.skipped)).toBe(true)
  })

  it('amnesty 失败不清台账:force throw → 文件仍含原残留条目', async () => {
    const ws = setupWs()
    fs.mkdirSync(path.join(ws, '.plc-act'), { recursive: true })
    const forcesPath = path.join(ws, '.plc-act/active-forces.json')
    fs.writeFileSync(forcesPath, JSON.stringify(['stale_a']))
    // force 总是 throw(模拟 runtime 不可达)
    const deps = okDeps({
      force: vi.fn(async () => { throw new Error('ECONNREFUSED') }),
    })
    await runVerify(path.join(ws, 'plan.json'), ws, deps)
    // 台账应仍含 stale_a(失败不清空)
    const remaining = JSON.parse(fs.readFileSync(forcesPath, 'utf8'))
    expect(remaining).toContain('stale_a')
  })
})

describe('runVerify --only 子集重跑', () => {
  function multiCaseWs() {
    const ws = setupWs()
    fs.writeFileSync(path.join(ws, 'plan.json'), JSON.stringify({ program: 'src/programs/a.st', cases: [
      { name: '红灯计时', type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] },
      { name: '绿灯轮转', type: 'steady', set: { a: true }, expect: [{ var: 'b', op: '==', value: true }] },
    ] }))
    return ws
  }
  it('only 命中:只跑匹配 case(大小写/trim 容错),不写 latest.json', async () => {
    const ws = multiCaseWs()
    const deps = okDeps()
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, deps, { only: '  绿灯轮转 ' })
    expect(deps.runCase).toHaveBeenCalledTimes(1)
    expect(deps.runCase.mock.calls[0][0].name).toBe('绿灯轮转')
    expect(envelope.summary).toMatch(/subset|子集/)
    // 子集运行不写 latest.json(保护版本门:出图前必须有全量 verify)
    expect(fs.existsSync(path.join(ws, '.plc-act/latest.json'))).toBe(false)
  })
  it('only 未命中 → stage=plan,列出可用 case 名', async () => {
    const ws = multiCaseWs()
    const { envelope } = await runVerify(path.join(ws, 'plan.json'), ws, okDeps(), { only: '不存在' })
    expect(envelope.failure?.stage).toBe('plan')
    expect(JSON.stringify(envelope.failure?.detail)).toMatch(/红灯计时|绿灯轮转/)
  })
  it('全量运行(无 only)仍写 latest.json', async () => {
    const ws = multiCaseWs()
    await runVerify(path.join(ws, 'plan.json'), ws, okDeps())
    expect(fs.existsSync(path.join(ws, '.plc-act/latest.json'))).toBe(true)
  })
})

describe('runVerify 自动 build 缓存门', () => {
  it('runtime 已 RUNNING 同一份 ST → 跳过 buildAndRun(step.cached=true)', async () => {
    const ws = setupWs()
    // readStateStCode 默认返回与 a.st 相同的源;status 改 RUNNING 即命中缓存
    const deps = okDeps({ status: vi.fn(async () => ({ status: 'RUNNING', isRunning: true, runtimeReachable: true })) })
    const { envelope, exitCode } = await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(deps.buildAndRun).not.toHaveBeenCalled()
    const br = envelope.steps.find(s => s.name === 'buildAndRun')
    expect(br?.cached).toBe(true)
    expect(br?.ok).toBe(true)
    expect(envelope.ok).toBe(true); expect(exitCode).toBe(0)
  })
  it('同码但 runtime STOPPED → 仍 buildAndRun(缓存门要求 RUNNING)', async () => {
    const ws = setupWs()
    const deps = okDeps()  // 默认 status=STOPPED
    await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(deps.buildAndRun).toHaveBeenCalledTimes(1)
  })
  it('RUNNING 但 ST 与 state 不一致 → 仍 buildAndRun', async () => {
    const ws = setupWs()
    const deps = okDeps({
      status: vi.fn(async () => ({ status: 'RUNNING', isRunning: true, runtimeReachable: true })),
      readStateStCode: vi.fn(() => 'DIFFERENT CODE'),
    })
    await runVerify(path.join(ws, 'plan.json'), ws, deps)
    expect(deps.buildAndRun).toHaveBeenCalledTimes(1)
  })
})
