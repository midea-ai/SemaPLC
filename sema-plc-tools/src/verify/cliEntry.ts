// verify CLI 生产装配:把真实 handler 面接线进 runner/caseExec 的注入口,
// 并承担 SIGTERM/SIGINT 限时清理与 active-forces.json 持久化台账(SIGKILL-safe)。
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash } from 'crypto'
import { safePath } from '../pathSafety.js'
import { loadConfig, type PlcConfig } from '../config.js'
import { RuntimeClient } from '../client/runtime.js'
import { handleStatus } from '../tools/status.js'
import { handleCompile } from '../tools/compile.js'
import { handleUpload } from '../tools/upload.js'
import { handleStart } from '../tools/start.js'
import { handleStop } from '../tools/stop.js'
import { handleBuildAndRun } from '../tools/buildAndRun.js'
import { handleForceVariables } from '../tools/forceVariables.js'
import { handleVerifyBehavior } from '../tools/verifyBehavior.js'
import { handleWaitFor } from '../tools/waitFor.js'
import { handleTrace } from '../tools/trace.js'
import { handleRecord, fetchLiveMd5 } from '../tools/record.js'
import { handleReadVariables } from '../tools/readVariables.js'
import { detectIO } from '../tools/detectIO.js'
import { readState } from '../state.js'
import { runVerify, type RunnerDeps, runVerifyParallel, type ParallelRunnerDeps, type CompileOnceResult, type DeployResult } from './runner.js'
import { runCase, type CaseDeps } from './caseExec.js'
import { resolveInstances, instanceCfgFor, type Instance } from './pool.js'
import { renderEnvelope } from './envelope.js'
import type { Envelope } from './planTypes.js'

const execFileAsync = promisify(execFile)

// .sema/.mcp.json 的 env block 是 MCP server 的口径来源;runner 必须同口径(spec §4):
// state.json 落点/动态 Modbus 端口等。已设的进程 env 优先(显式覆盖仍可用)。
export function loadCfgFromMcpJson(cwd: string): PlcConfig {
  try {
    const mcp = JSON.parse(fs.readFileSync(path.join(cwd, '.sema', '.mcp.json'), 'utf8'))
    const env = mcp?.mcpServers?.['plc-tools']?.env as Record<string, string> | undefined
    if (env) for (const [k, v] of Object.entries(env)) if (process.env[k] === undefined) process.env[k] = String(v)
  } catch { /* 无 .mcp.json(headless)→ 直接用进程 env */ }
  return loadConfig()
}

// 台账路径:id 省略 → 'active-forces.json'(serial 路径,与今天一致);
// id 给定 → 'active-forces.<id>.json'(parallel 路径,每实例一个文件,各自 string[])。
export function activeForcesPath(wsRoot: string, id?: number): string {
  const name = id === undefined ? 'active-forces.json' : `active-forces.${id}.json`
  return path.join(wsRoot, '.plc-act', name)
}

function readForceLedger(p: string): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch { /* 不存在/损坏 → 视为空台账 */ }
  return []
}

// 先登记后 force(SIGKILL-safe):writeFileSync 必须发生在 force 调用之前,
// 进程被 -9 杀掉后,下次 runner 的 amnesty 步仍能从台账释放残留。
// id 省略=serial(active-forces.json);给定=parallel 第 id 实例(active-forces.<id>.json)。
export function registerForces(wsRoot: string, names: string[], id?: number): void {
  const p = activeForcesPath(wsRoot, id)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  const merged = [...new Set([...readForceLedger(p), ...names])]
  fs.writeFileSync(p, JSON.stringify(merged))
}

export function unregisterForces(wsRoot: string, names: string[], id?: number): void {
  const p = activeForcesPath(wsRoot, id)
  const rm = new Set(names)
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(readForceLedger(p).filter(n => !rm.has(n))))
  } catch { /* 回写失败不阻断——台账偏保守(多释放无害) */ }
}

// 列出 .plc-act 下所有台账文件:legacy active-forces.json(id=null)+ 每实例
// active-forces.<id>.json(id=number)。供 parallel cleanup / SIGTERM 遍历:
// id=null 用 cfg.url 的 client release,id=number 用对应实例 client release。
export function ledgerFiles(wsRoot: string): { id: number | null; path: string; names: string[] }[] {
  const dir = safePath(path.join(wsRoot, '.plc-act'), wsRoot)
  let entries: string[]
  try { entries = fs.readdirSync(dir) } catch { return [] }
  const out: { id: number | null; path: string; names: string[] }[] = []
  for (const f of entries) {
    const m = f.match(/^active-forces(?:\.(\d+))?\.json$/)
    if (!m) continue
    const p = path.join(dir, f)
    out.push({ id: m[1] === undefined ? null : parseInt(m[1], 10), path: p, names: readForceLedger(p) })
  }
  return out
}

// D1 分支判定:plan 显式 options.serial:true 时强制走 serial(即便 poolSize>1)。
// 轻量预读(完整校验仍在 runner 内);解析失败 → 不算 serial,让 parallel runner 报 plan 错。
function planWantsSerial(planPath: string): boolean {
  try { return JSON.parse(fs.readFileSync(planPath, 'utf8'))?.options?.serial === true }
  catch { return false }
}

export async function runVerifyCli(planFile: string, opts: { only?: string } = {}): Promise<number> {
  const cwd = process.cwd()
  const cfg = loadCfgFromMcpJson(cwd)
  const wsRoot = cfg.workspace ?? cwd
  const planPath = path.resolve(cwd, planFile)

  // D1 硬切:poolSize>1 且未声明 serial → parallel 分支;否则今天的 serial(下方一行不改)。
  if (cfg.poolSize > 1 && !planWantsSerial(planPath)) {
    return runVerifyCliParallel(planPath, wsRoot, cfg, opts)
  }

  const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)

  const caseDeps = (budgetMs: number): CaseDeps => ({
    force: i => handleForceVariables(i, cfg),
    verifyBehavior: (i, b) => handleVerifyBehavior(i, cfg, { budgetMs: b }),
    waitFor: (i, b) => handleWaitFor(i, cfg, undefined, b),
    trace: (i, w) => handleTrace(i, cfg, undefined, w),
    record: i => handleRecord(i, cfg),
    readVariables: names => handleReadVariables({ varNames: names }, cfg),
    registerForces: names => registerForces(wsRoot, names),
    unregisterForces: names => unregisterForces(wsRoot, names),
    budgetMs,
    now: Date.now,
  })

  const deps: RunnerDeps = {
    status: () => handleStatus(client),
    buildAndRun: stCode => handleBuildAndRun({ stCode }, {
      compile: i => handleCompile(i, cfg),
      upload: () => handleUpload({} as Record<string, never>, cfg, undefined, { gccTimeoutMs: 40_000 }),
      start: () => handleStart(client, { maxMs: 12_000 }),
    }),
    runCase: (c, b) => runCase(c, caseDeps(b)),
    force: i => handleForceVariables(i, cfg),
    stop: opts => handleStop(client, opts),
    detectIO,
    readVariableMap: () => readState(cfg.stateFile).lastCompile?.variableMap ?? [],
    readStateStCode: () => readState(cfg.stateFile).lastCompile?.stCode ?? null,
    now: Date.now,
    start: () => handleStart(client, { maxMs: 12_000 }),
  }

  // SIGTERM/SIGINT:限时(8s)尽力清理 force + 停 PLC,输出部分信封后退出。
  // interrupted 标志防重入(两个信号都来时只清理一次)。
  let interrupted = false
  const onSignal = async (): Promise<void> => {
    if (interrupted) return
    interrupted = true
    const cleanup: Envelope['cleanup'] = { released: [], releaseFailed: [], stopOk: null }
    const doCleanup = async (): Promise<void> => {
      const names = readForceLedger(activeForcesPath(wsRoot))
      if (names.length > 0) {
        try {
          const fr = await handleForceVariables({ release: names }, cfg)
          if (fr.success && fr.failed.length === 0) {
            cleanup.released.push(...names)
            // 与 runner.releaseResidualForces 同语义:只有 release 成功才清空台账
            try { fs.writeFileSync(activeForcesPath(wsRoot), '[]') } catch { /* 清空失败不阻断 */ }
          } else cleanup.releaseFailed.push(...names)
        } catch { cleanup.releaseFailed.push(...names) }
      }
      try {
        const sr = await handleStop(client, { maxMs: 5000 })
        cleanup.stopOk = sr.success
      } catch { cleanup.stopOk = false }
    }
    await Promise.race([doCleanup(), new Promise<void>(r => setTimeout(r, 8_000))])
    // runner 的 finalize 不会执行(进程即将退出):lock 必须在这里删,
    // 否则 bridge 的 mute 要等 mtime 过期(最长 150s)才解除。
    try { fs.rmSync(path.join(wsRoot, '.plc-act', 'running.lock'), { force: true }) } catch { /* 尽力 */ }
    const envelope: Envelope = {
      ok: false,
      summary: 'interrupted (SIGTERM/SIGINT) — 已尽力清理 force 并停 PLC',
      stHash: null,
      steps: [],
      failure: { stage: 'timeout', detail: 'interrupted' },
      cleanup,
      artifacts: { runDir: null },
    }
    console.log(renderEnvelope(envelope))
    process.exit(0)
  }
  process.once('SIGTERM', () => { void onSignal() })
  process.once('SIGINT', () => { void onSignal() })

  console.error(`[verify] plan=${planFile} ws=${wsRoot}${opts.only ? ` only=${opts.only}` : ''}`)
  const { envelope, exitCode } = await runVerify(path.resolve(cwd, planFile), wsRoot, deps, { only: opts.only })
  console.log(renderEnvelope(envelope))
  return exitCode
}

// ═══════════════════════ parallel 装配(spec 2026-06-16 §3b)═══════════════════════

// matiec 编译一次(在 inst0 容器内,写 state)→ docker cp zip → host Buffer(供各实例 uploadZip)。
async function poolCompileOnce(stCode: string, inst0: Instance): Promise<CompileOnceResult> {
  const cr = await handleCompile({ stCode }, inst0.cfg)
  if (!cr.success) return { ok: false, failStage: 'compile', detail: cr.iec2c ?? cr }
  // 0x45 live md5 == md5(ST 源码字节)(spike 实测),作为部署后硬门的期望值。
  const expectedMd5 = createHash('md5').update(Buffer.from(stCode, 'utf8')).digest('hex')
  const zipPath = readState(inst0.cfg.stateFile).lastCompile?.zipPath
  if (!zipPath) return { ok: false, failStage: 'compile', detail: 'compile 后 state 无 zipPath' }
  if (fs.existsSync(zipPath)) return { ok: true, zipBuffer: fs.readFileSync(zipPath), expectedMd5 }   // host 侧已有
  const tmp = path.join(os.tmpdir(), `plc-pool-${process.pid}-${Date.now()}.zip`)
  try {
    await execFileAsync('docker', ['cp', `${inst0.cfg.container}:${zipPath}`, tmp])
    return { ok: true, zipBuffer: fs.readFileSync(tmp), expectedMd5 }
  } catch (e) {
    return { ok: false, failStage: 'compile', detail: `docker cp zip 失败(${inst0.cfg.container}:${zipPath}): ${e}` }
  } finally { try { fs.rmSync(tmp, { force: true }) } catch { /* */ } }
}

// 把 Buffer 部署到一个实例:uploadZip → GCC → stop→start → md5 硬门(Phase 2)。不走 handleUpload。
async function deployToInstance(co: CompileOnceResult, inst: Instance): Promise<DeployResult> {
  const up = await inst.client.uploadZip(co.zipBuffer!, 'program.zip')
  if (!up.ok) return { ok: false, failStage: 'gcc', detail: up.error }
  const poll = await inst.client.pollCompilationStatus(2000, 40_000)
  if (poll.status !== 'SUCCESS') return { ok: false, failStage: 'gcc', detail: { gccStatus: poll.status, gccErrors: poll.gccErrors } }
  try { await handleStop(inst.client, { maxMs: 5000, pollMs: 250 }) } catch { /* best-effort:换载前先停 */ }
  const st = await handleStart(inst.client, { maxMs: 12_000 })
  if (!st.success) return { ok: false, failStage: 'start', detail: st }

  // md5 硬门:0x45 live md5 == md5(stCode) 才算真换载成功;不符 → stop→start 重试一次。
  if (co.expectedMd5) {
    let live: string | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try { live = await fetchLiveMd5(inst.cfg.url, await inst.client.getAuthToken()) } catch { live = null }
      if (live === co.expectedMd5) return { ok: true }
      // 不符:换载残留(start 拉起旧程序)→ 再 stop→start 一次后重读
      try { await handleStop(inst.client, { maxMs: 5000, pollMs: 250 }); await handleStart(inst.client, { maxMs: 12_000 }) } catch { /* */ }
    }
    return { ok: false, failStage: 'version-conflict', detail: { expectedMd5: co.expectedMd5, liveMd5: live, note: '换载重试后 runtime 加载的程序 md5 仍与期望不符' } }
  }
  return { ok: true }
}

async function runVerifyCliParallel(planPath: string, wsRoot: string, cfg: PlcConfig, opts: { only?: string }): Promise<number> {
  const instances = resolveInstances(cfg)

  const caseDepsFor = (budgetMs: number, inst: Instance): CaseDeps => ({
    force: i => handleForceVariables(i, inst.cfg),
    verifyBehavior: (i, b) => handleVerifyBehavior(i, inst.cfg, { budgetMs: b }),
    waitFor: (i, b) => handleWaitFor(i, inst.cfg, undefined, b),
    trace: (i, w) => handleTrace(i, inst.cfg, undefined, w),
    record: i => handleRecord(i, inst.cfg),
    readVariables: names => handleReadVariables({ varNames: names }, inst.cfg),
    registerForces: names => registerForces(wsRoot, names, inst.id),
    unregisterForces: names => unregisterForces(wsRoot, names, inst.id),
    budgetMs,
    now: Date.now,
  })

  // 遍历所有台账文件(legacy id=null 用 cfg / 实例 id 用对应实例 cfg)release;成功则删该文件。
  const releaseResidual = async (): Promise<{ released: string[]; releaseFailed: string[] }> => {
    const released: string[] = []
    const releaseFailed: string[] = []
    for (const f of ledgerFiles(wsRoot)) {
      if (f.names.length === 0) { try { fs.rmSync(f.path, { force: true }) } catch { /* */ } ; continue }
      const fcfg = f.id === null ? cfg : instanceCfgFor(cfg, f.id)
      try {
        const fr = await handleForceVariables({ release: f.names }, fcfg)
        if (fr.success && fr.failed.length === 0) { released.push(...f.names); try { fs.rmSync(f.path, { force: true }) } catch { /* */ } }
        else releaseFailed.push(...f.names)
      } catch { releaseFailed.push(...f.names) }
    }
    return { released, releaseFailed }
  }

  const deps: ParallelRunnerDeps = {
    instances,
    status: inst => handleStatus(inst.client),
    compileOnce: stCode => poolCompileOnce(stCode, instances[0]),
    deploy: (co, inst) => deployToInstance(co, inst),
    runCase: (c, b, inst) => runCase(c, caseDepsFor(b, inst)),
    releaseResidual,
    stop: (inst, o) => handleStop(inst.client, o),
    detectIO,
    readVariableMap: () => readState(cfg.stateFile).lastCompile?.variableMap ?? [],
    now: Date.now,
  }

  // parallel SIGTERM:释放所有台账 + 停所有池实例,删 lock,输出 interrupted 信封。
  let interrupted = false
  const onSignal = async (): Promise<void> => {
    if (interrupted) return
    interrupted = true
    const cleanup: Envelope['cleanup'] = { released: [], releaseFailed: [], stopOk: null }
    const doCleanup = async (): Promise<void> => {
      const r = await releaseResidual()
      cleanup.released.push(...r.released); cleanup.releaseFailed.push(...r.releaseFailed)
      try {
        const srs = await Promise.allSettled(instances.map(i => handleStop(i.client, { maxMs: 5000 })))
        cleanup.stopOk = srs.every(s => s.status === 'fulfilled' && s.value.success)
      } catch { cleanup.stopOk = false }
    }
    await Promise.race([doCleanup(), new Promise<void>(r => setTimeout(r, 8_000))])
    try { fs.rmSync(path.join(wsRoot, '.plc-act', 'running.lock'), { force: true }) } catch { /* 尽力 */ }
    console.log(renderEnvelope({
      ok: false, summary: 'interrupted (SIGTERM/SIGINT) — 已尽力清理 force 并停所有池实例',
      stHash: null, steps: [], failure: { stage: 'timeout', detail: 'interrupted' }, cleanup, artifacts: { runDir: null },
    }))
    process.exit(0)
  }
  process.once('SIGTERM', () => { void onSignal() })
  process.once('SIGINT', () => { void onSignal() })

  console.error(`[verify|parallel pool=${cfg.poolSize}] plan=${planPath} ws=${wsRoot}`)
  const { envelope, exitCode } = await runVerifyParallel(planPath, wsRoot, deps, { only: opts.only })
  console.log(renderEnvelope(envelope))
  return exitCode
}
