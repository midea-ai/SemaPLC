// tests/integration/verifyCleanup.integration.test.ts
// verify 清理三路径回归(0611 held-force 事故防线)。
// Run with: npm run test:integration -- tests/integration/verifyCleanup.integration.test.ts
// Requires: Docker container 'openplc-plc-dev' running (W1-D1-D2)
//
// 实测约束(决定断言口径):PLC STOPPED 时 /api/debug 读变量失败
// ("No response from runtime"),所以"force 已在 runtime 真实释放"的活值证明
// 只能在路径 2(stopAfter:false,PLC 保持 RUNNING)做;路径 1/3 结束时 PLC
// 已停,以台账(active-forces.json)+ 信封 cleanup 为准。

import { describe, it, expect, afterEach, afterAll, beforeAll } from 'vitest'
import { spawn, execFile, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { safePath } from '../../src/pathSafety.js'
import { handleStatus } from '../../src/tools/status.js'
import { handleStop } from '../../src/tools/stop.js'
import { handleStart } from '../../src/tools/start.js'
import { handleCompile } from '../../src/tools/compile.js'
import { handleUpload } from '../../src/tools/upload.js'
import { handleForceVariables } from '../../src/tools/forceVariables.js'
import { handleReadVariables } from '../../src/tools/readVariables.js'
import { RuntimeClient } from '../../src/client/runtime.js'
import type { PlcConfig } from '../../src/config.js'
import type { Envelope } from '../../src/verify/planTypes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 测试跑的是 dist——改了 src/verify 须先 npm run build
const cliAbs = path.resolve(__dirname, '../../dist/cli.js')

// 注意:不能叫 PROGRAM main + TASK Main——matiec 把两者都生成 C 符号 MAIN,
// GCC 报 "MAIN redeclared"(实测)。沿用 full-chain 样例的命名约定。
const PASSTHROUGH_ST = `
PROGRAM passthrough
  VAR
    btn AT %IX0.0 : BOOL;
    led AT %QX0.0 : BOOL;
  END_VAR
  led := btn;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK TaskMain(INTERVAL := T#20ms, PRIORITY := 0);
    PROGRAM Inst0 WITH TaskMain : passthrough;
  END_RESOURCE
END_CONFIGURATION
`

interface Ctx { ws: string; cfg: PlcConfig; env: NodeJS.ProcessEnv }

function mkWs(): Ctx {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-cleanup-'))
  const stateFile = path.join(ws, 'state.json')
  fs.writeFileSync(path.join(ws, 'program.st'), PASSTHROUGH_ST)
  const cfg: PlcConfig = {
    url: process.env.PLC_URL ?? 'https://localhost:8443',
    container: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
    checkStdlibDir: process.env.PLC_CHECK_STDLIB_DIR ?? '/opt/iec61131-stdlib',
    user: process.env.PLC_USER ?? 'admin',
    password: process.env.PLC_PASSWORD ?? 'admin123',
    stateFile,
  }
  // 子进程与本测试共用 stateFile(variableMap/skipBuild 校验都依赖它);
  // 不设 PLC_WORKSPACE → cliEntry 的 wsRoot = cwd = ws
  const env = { ...process.env, PLC_STATE_FILE: stateFile }
  delete env.PLC_WORKSPACE
  return { ws, cfg, env }
}

function writePlan(ws: string, name: string, plan: unknown): string {
  fs.writeFileSync(path.join(ws, name), JSON.stringify(plan, null, 2))
  return name
}

function ledgerOf(ws: string): string[] | null {
  const p = path.join(ws, '.plc-act', 'active-forces.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf8')) as string[]
}

function runCli(ctx: Ctx, planFile: string): { child: ChildProcess; result: Promise<{ code: number | null; stdout: string; stderr: string }> } {
  const child = spawn('node', [safePath(cliAbs), 'verify', safePath(planFile)], { cwd: ctx.ws, env: ctx.env })
  let stdout = ''
  let stderr = ''
  child.stdout!.on('data', (d: Buffer) => { stdout += d.toString() })
  child.stderr!.on('data', (d: Buffer) => { stderr += d.toString() })
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>(resolve => {
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
  return { child, result }
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const execFileAsync = promisify(execFile)

describe('verify 清理三路径(真实 runtime)', () => {
  let ctx: Ctx | null = null
  let liveChild: ChildProcess | null = null
  const client = new RuntimeClient(
    process.env.PLC_URL ?? 'https://localhost:8443',
    process.env.PLC_USER ?? 'admin',
    process.env.PLC_PASSWORD ?? 'admin123',
  )

  // 兜底:测试自身失败也不许把 held-force / 运行中 PLC 留给下一条
  afterEach(async () => {
    if (liveChild && liveChild.exitCode === null) {
      liveChild.kill('SIGKILL')
      liveChild = null
    }
    if (ctx) {
      await handleForceVariables({ release: ['btn'] }, ctx.cfg).catch(() => null)
      await handleStop(client).catch(() => null)
      fs.rmSync(ctx.ws, { recursive: true, force: true })
      ctx = null
    }
  }, 30_000)

  // 预热换载(0613 取证 probe3,见 commit 信息):OpenPLC 存在 upload→start 换载竞态——
  // upload 报 gcc SUCCESS、start 报 RUNNING,但 start 实际拉起的是**上一个**已加载程序
  // (~1/6 概率;debug 0x44 按新 variableMap 读必然错位/空值),stop→start 一轮才换载。
  // 本文件三条路径都经 dist/cli.js 的 buildAndRun 上传同一 passthrough,测试层无法在
  // CLI 内部插入校验;对策是开跑前把 passthrough 先 upload+start+stop 预热一轮,使
  // "已加载程序 == 本文件要上传的程序",竞态退化为无害(旧==新,行为一致)。
  // 没有预热时,竞态命中路径1 的表现:runtime 仍跑上一文件的 chain_verify,led(idx1)
  // 实际读到的是 output_flag(逐扫描翻转)→ expect led==false 立即满足 → env.ok 误为
  // true——这正是 0612"失败集漂移"中路径1 的根因(runtime 是跨文件/跨轮次共享态,
  // 叠加 vitest 按缓存时长/失败排序换文件顺序,失败集随之漂移)。
  beforeAll(async () => {
    const prime = mkWs()
    try {
      await handleStop(client).catch(() => null)
      const c = await handleCompile({ stCode: PASSTHROUGH_ST }, prime.cfg)
      if (!c.success) throw new Error(`预热 compile 失败:${c.errorSummary}`)
      const u = await handleUpload({}, prime.cfg)
      if (!u.success) throw new Error(`预热 upload 失败:gcc=${u.gccStatus} ${u.uploadError ?? ''}`)
      // 即便这次 start 因竞态拉起旧程序也无妨——最新 .so 已是 passthrough,
      // 随后 stop,下一次 start(路径1 的 buildAndRun)从停机态加载的就是它
      await handleStart(client)
      await handleStop(client)
    } finally {
      fs.rmSync(prime.ws, { recursive: true, force: true })
    }
  }, 120_000)

  // 全文件收尾:路径3 的 SIGTERM-mid-trace 按设计会把 runtime 打挂——0613 取证实测:
  // runtime 进程在 mid-trace 停机中崩溃 → 守护重启进 SAFE MODE("PLC program will not
  // be loaded"),之后第一次 upload 会触发自动装载+自动起跑,换载竞态在该路径上更易
  // 命中(实测命中后持续整个会话:debug 0x44 对 INT 索引持续返回 1 字节 BOOL,tick
  // 步进按 20ms 而非新程序的 100ms)。本文件是 wedge 制造者,负责清理战场:重启容器
  // (实测 ~5s 恢复)并停机,保证后续文件/轮次进入干净 runtime。
  // 注意:换载竞态是 OpenPLC runtime 的真 bug(upload+start 成功但程序未换载),
  // 工具层(plc_upload/plc_start)对此无感知——已另行上报,此处只做测试侧消弭。
  afterAll(async () => {
    await execFileAsync('docker', ['restart', process.env.PLC_CONTAINER ?? 'openplc-plc-dev'])
    const deadline = Date.now() + 60_000
    let canonical = false
    while (Date.now() < deadline) {
      const st = await handleStatus(client).catch(() => null)
      if (st?.runtimeReachable && ['STOPPED', 'EMPTY', 'RUNNING'].includes(st.status)) { canonical = true; break }
      await sleep(1000)
    }
    if (!canonical) throw new Error('docker restart 后 runtime 未在 60s 内恢复——环境异常,先查容器')
    // 重启后 runtime 会自动拉起上次上传的程序(RUNNING)——停掉,
    // 保持"本文件结束 = PLC 已停"的确定性基线
    await handleStop(client)
  }, 120_000)

  it('路径1:assert 失败也清场——exit 0 + 信封 ok:false/assert + 台账空 + stopAfter 默认停机', async () => {
    ctx = mkWs()
    // 直通程序 force btn=true → led 必为 true → expect led==false 必然 assert 失败。
    // settleMs 300:force ack 到 led 随扫描更新有 1-2 个扫描周期的传播延迟,不等一拍
    // 的话首轮 poll 可能在 force 生效前读到初值 led=false → expect 即满足 → ok 误为
    // true(负向断言的"初值即满足"陷阱)。信封的污染预检 hint"开跑前断言已全部成立"
    // 在本 plan 必然出现(expect led==false 开跑前天然成立),正是为此场景设的标注。
    const planFile = writePlan(ctx.ws, 'plan.json', {
      program: 'program.st',
      cases: [
        { name: 'assert-fail', type: 'steady', set: { btn: true }, settleMs: 300, expect: [{ var: 'led', op: '==', value: false }] },
      ],
    })
    const { code, stdout } = await runCli(ctx, planFile).result

    // ① 失败也 exit 0(信封即结果,不靠 exit code 传递)
    expect(code).toBe(0)
    // ② stdout 是可 parse 信封:ok:false,失败定性为 assert(而非环境/caseSetup)
    const env = JSON.parse(stdout) as Envelope
    expect(env.ok).toBe(false)
    expect(env.failure?.stage).toBe('assert')
    // ③ force 已释放:台账为空数组(caseExec finally 释放 + unregister)
    expect(ledgerOf(ctx.ws) ?? []).toEqual([])
    // ④ stopAfter 默认 true → PLC 已停
    expect(env.cleanup.stopOk).toBe(true)
    const st = await handleStatus(client)
    expect(st.runtimeReachable).toBe(true)
    expect(st.isRunning).toBe(false)
  }, 90_000)

  it('路径2:stopAfter:false 不停机且台账已清(活值证明 force 释放)→ skipBuild 复用 ok', async () => {
    ctx = mkWs()
    // plan A:通过的 case + stopAfter:false → 跑完 PLC 仍 RUNNING
    const planA = writePlan(ctx.ws, 'planA.json', {
      program: 'program.st',
      options: { stopAfter: false },
      cases: [
        { name: 'passthrough-on', type: 'steady', set: { btn: true }, expect: [{ var: 'led', op: '==', value: true }] },
      ],
    })
    const a = await runCli(ctx, planA).result
    expect(a.code).toBe(0)
    const envA = JSON.parse(a.stdout) as Envelope
    expect(envA.ok).toBe(true)
    // stopAfter:false → 不停机(且 finalize 没动它:stopOk 保持 null)
    expect(envA.cleanup.stopOk).toBeNull()
    const stA = await handleStatus(client)
    expect(stA.isRunning).toBe(true)
    // 台账已清 + 活值证明:PLC 仍在跑,btn 读回物理输入 false → force 真在 runtime 释放了
    expect(ledgerOf(ctx.ws) ?? []).toEqual([])
    const read = await handleReadVariables({ varNames: ['btn'] }, ctx.cfg)
    expect(read.success).toBe(true)
    expect(read.variables['btn']?.value).toBe(false)

    // plan B:skipBuild:true 复用运行中的程序(真实 version-check 路径),stopAfter 默认 true
    const planB = writePlan(ctx.ws, 'planB.json', {
      program: 'program.st',
      options: { skipBuild: true },
      cases: [
        { name: 'passthrough-again', type: 'steady', set: { btn: true }, expect: [{ var: 'led', op: '==', value: true }] },
      ],
    })
    const b = await runCli(ctx, planB).result
    expect(b.code).toBe(0)
    const envB = JSON.parse(b.stdout) as Envelope
    expect(envB.ok).toBe(true)
    expect(envB.steps.find(s => s.name === 'version-check')?.ok).toBe(true)
    expect(envB.steps.find(s => s.name === 'buildAndRun')).toBeUndefined()
    // plan B 的 stopAfter 默认 true → 收尾停机
    const stB = await handleStatus(client)
    expect(stB.isRunning).toBe(false)
  }, 120_000)

  it('路径3:trace 持有 force 期间 SIGTERM——handler 释放 force + 清台账 + 删 lock + 停机 + 部分信封', async () => {
    ctx = mkWs()
    // 长 trace(20s)+ set btn=true:kill 时正在采样且 force 已施加并登记
    const planFile = writePlan(ctx.ws, 'plan.json', {
      program: 'program.st',
      cases: [
        {
          name: 'long-trace', type: 'trace', vars: ['led'], durationMs: 20_000,
          set: { btn: true },
          expectShape: [{ var: 'led', kind: 'range', min: 0, max: 1 }],
        },
      ],
    })
    const { child, result } = runCli(ctx, planFile)
    liveChild = child

    // 等进入 trace case:runTrace 先登记台账再 force → 台账含 btn 即说明 build 完成、case 已开跑
    const deadline = Date.now() + 70_000
    let entered = false
    while (Date.now() < deadline) {
      if (child.exitCode !== null) break   // 子进程提前退出(build 失败等)→ 下面给出诊断
      if ((ledgerOf(ctx.ws) ?? []).includes('btn')) { entered = true; break }
      await sleep(250)
    }
    if (!entered) {
      const r = await result
      throw new Error(`未进入 trace case(子进程已退?code=${r.code})\nstdout=${r.stdout}\nstderr=${r.stderr}`)
    }
    await sleep(2_000)   // 让 force 调用真正落到 runtime、采样开始
    child.kill('SIGTERM')

    const { code, stdout } = await result
    liveChild = null
    // ① SIGTERM 清理路径也 exit 0
    expect(code).toBe(0)
    // ② stdout 是部分信封:stage timeout / detail interrupted / summary 标注 interrupted
    const env = JSON.parse(stdout) as Envelope
    expect(env.ok).toBe(false)
    expect(env.failure?.stage).toBe('timeout')
    expect(env.failure?.detail).toBe('interrupted')
    expect(env.summary).toContain('interrupted')
    // ③ handler 已释放持有的 force 并清空台账(release 成功才清)
    expect(env.cleanup.released).toContain('btn')
    expect(env.cleanup.releaseFailed).toEqual([])
    expect(ledgerOf(ctx.ws) ?? []).toEqual([])
    // ④ running.lock 已删(runner finalize 不会执行,必须由 handler 删)
    expect(fs.existsSync(path.join(ctx.ws, '.plc-act', 'running.lock'))).toBe(false)
    // ⑤ handler 调了 stop → 最终非 RUNNING。实测:mid-trace 停机要经过 ERROR 暂态
    //    再落 STOPPED,常超出 onSignal 的 8s 清理竞赛 → stopOk 为 null(已发停机
    //    指令但未等到确认),而非 false(确认失败)。硬要求是 PLC 真的停了。
    expect(env.cleanup.stopOk).not.toBe(false)
    let running = true
    const stopDeadline = Date.now() + 15_000
    while (Date.now() < stopDeadline) {
      const st = await handleStatus(client)
      if (st.runtimeReachable && !st.isRunning) { running = false; break }
      await sleep(500)
    }
    expect(running).toBe(false)
  }, 120_000)
})
