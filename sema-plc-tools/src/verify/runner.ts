// verify runner — 纯编排:全部副作用经注入 deps(生产装配在 cliEntry/Task 13);
// runner 自身只直接做 fs(lock/latest/runDir 落盘是它的职责,不注入)。
import * as fs from 'fs'
import * as path from 'path'
import { safePath } from '../pathSafety.js'
import { parsePlanText, normalizeAndValidate } from './planParse.js'
import { stHashOf } from './hash.js'
import { TOTAL_BUDGET_MS, CLEANUP_RESERVE_MS, precheckBudget } from './budget.js'
import { buildNameSuggestions } from '../tools/readVariables.js'
import type { VerifyPlan, PlanCase, Envelope, EnvelopeStep, FailureStage } from './planTypes.js'
import type { CaseRunResult } from './caseExec.js'
import type {
  StatusResult, BuildAndRunResult, ForceVariablesInput, ForceVariablesResult,
  StartStopResult, VariableEntry, DetectIOResult,
} from '../types.js'
import { runWithPool, type Instance } from './pool.js'

export interface RunnerDeps {
  status: () => Promise<StatusResult>
  buildAndRun: (stCode: string) => Promise<BuildAndRunResult>
  runCase: (c: PlanCase, budgetMs: number) => Promise<CaseRunResult>
  force: (i: ForceVariablesInput) => Promise<ForceVariablesResult>
  stop: (opts?: { maxMs?: number; pollMs?: number }) => Promise<StartStopResult>
  detectIO: (stCode: string) => DetectIOResult
  readVariableMap: () => VariableEntry[]      // build 后从 state 读
  readStateStCode: () => string | null        // skipBuild 校验用
  now: () => number
  start?: () => Promise<StartStopResult>      // resetBefore 可选
}

const CONN_ERROR_RE = /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|socket/i

const STAGE_DESC: Partial<Record<FailureStage, string>> = {
  plan: 'plan 校验失败',
  compile: '编译失败(iec2c)',
  gcc: '部署失败(GCC/upload)',
  start: '启动失败',
  runtime: 'runtime 不可达',
  'version-conflict': 'runtime 程序与 .st 不一致(去掉 skipBuild 重新编译)',
  timeout: '总预算耗尽',
  exception: '运行器异常',
}

// 静态预检只看会被 force 的变量(仅 set 键)——when.var 是观察量(可为 FB 内部变量),不作 force
// expect/when.var 统一交给 build 后的全变量预检(collectAllVars 已包含)
function collectForcedVars(cases: PlanCase[]): string[] {
  const out: string[] = []
  for (const c of cases) {
    switch (c.type) {
      case 'steady':
        out.push(...Object.keys(c.set))
        break
      case 'trace':
        out.push(...Object.keys(c.set ?? {}))
        break
      case 'sequence':
        for (const s of c.steps) out.push(...Object.keys(s.set ?? {}))
        break
    }
  }
  return out
}

function collectAllVars(cases: PlanCase[]): string[] {
  const out: string[] = []
  for (const c of cases) {
    switch (c.type) {
      case 'steady':
        out.push(...Object.keys(c.set), ...c.expect.map(e => e.var))
        if (c.when) out.push(c.when.var)
        break
      case 'trace':
        out.push(...c.vars, ...Object.keys(c.set ?? {}), ...c.expectShape.map(s => s.var))
        break
      case 'record':
        out.push(...c.vars, ...c.expectShape.map(s => s.var))
        break
      case 'sequence':
        for (const s of c.steps) {
          out.push(...Object.keys(s.set ?? {}))
          if (s.waitFor) out.push(s.waitFor.var)
          out.push(...(s.expect ?? []).map(e => e.var))
        }
        break
    }
  }
  return out
}

function caseOneLiner(r: CaseRunResult): string {
  if (r.hints.length > 0) return r.hints[0]
  const s = JSON.stringify(r.detail ?? {})
  return s.length > 200 ? s.slice(0, 200) + '…' : s
}

export async function runVerify(
  planPath: string,
  workspaceRoot: string,
  deps: RunnerDeps,
  opts: { only?: string } = {},
): Promise<{ envelope: Envelope; exitCode: number }> {
  const t0 = deps.now()
  const steps: EnvelopeStep[] = []
  const cleanup: Envelope['cleanup'] = { released: [], releaseFailed: [], stopOk: null }
  const caseResults: CaseRunResult[] = []
  let failure: Envelope['failure'] | undefined
  let plan: VerifyPlan | null = null
  // --only 子集重跑(迭代辅助):只跑指定 case;不写 latest.json,以免子集结果
  // 冒充全量签收(buildSimulation 版本门仍要求全量 ok:true 才放行)。
  let subset = false
  let planText: string | null = null
  let stCode: string | null = null
  let stHash: string | null = null
  let runDirRel: string | null = null
  let built = false
  let runtimeStatus: string | null = null   // 第6步存下 runtime 当前状态,供第7步自动缓存门判断

  const plcActDir = safePath(path.join(workspaceRoot, '.plc-act'), workspaceRoot)
  const lockPath = safePath(path.join(plcActDir, 'running.lock'), workspaceRoot)
  const forcesPath = safePath(path.join(plcActDir, 'active-forces.json'), workspaceRoot)

  function fail(stage: FailureStage, detail?: unknown, hints?: string[]): void {
    failure = { stage, ...(detail !== undefined ? { detail } : {}), ...(hints?.length ? { hints } : {}) }
  }

  // amnesty / 终态清理共用:release active-forces.json 残留;只在成功时清空台账
  async function releaseResidualForces(): Promise<{ ok: boolean; names: string[] }> {
    if (!fs.existsSync(forcesPath)) return { ok: true, names: [] }
    let names: string[] = []
    try {
      const parsed = JSON.parse(fs.readFileSync(forcesPath, 'utf8'))
      if (Array.isArray(parsed)) names = parsed.filter((x): x is string => typeof x === 'string')
    } catch { /* 文件损坏视为无残留 */ }
    if (names.length === 0) return { ok: true, names: [] }
    let ok = true
    try {
      const fr = await deps.force({ release: names })
      // success 且 failed 为空:全部 release 成功
      ok = fr.success && fr.failed.length === 0
    } catch { ok = false }
    if (ok) {
      cleanup.released.push(...names)
      // 只有 release 成功才清空台账,失败时保留文件原内容防止残留永久失踪
      try { fs.writeFileSync(forcesPath, '[]') } catch { /* 清空失败不阻断 */ }
    } else {
      cleanup.releaseFailed.push(...names)
    }
    return { ok, names }
  }

  async function main(): Promise<void> {
    // 1. 目录 + runDir + lock
    fs.mkdirSync(plcActDir, { recursive: true })
    runDirRel = ['.plc-act', 'runs', new Date().toISOString().replace(/[:.]/g, '-')].join('/')
    fs.mkdirSync(safePath(path.join(workspaceRoot, runDirRel), workspaceRoot), { recursive: true })
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, planPath }))

    // 2. amnesty:上次残留 force 先释放
    {
      const s0 = deps.now()
      const r = await releaseResidualForces()
      if (r.names.length > 0) steps.push({ name: 'amnesty', ok: r.ok, ms: deps.now() - s0 })
    }

    // 3. plan 解析 + 校验
    {
      const s0 = deps.now()
      try {
        planText = fs.readFileSync(safePath(planPath), 'utf8')
      } catch (e) {
        steps.push({ name: 'plan', ok: false, ms: deps.now() - s0 })
        return fail('plan', { errors: [{ path: planPath, message: `无法读取 plan 文件: ${String(e)}` }] })
      }
      const { raw, errors: parseErrors } = parsePlanText(planText)
      if (parseErrors.length > 0) {
        steps.push({ name: 'plan', ok: false, ms: deps.now() - s0 })
        return fail('plan', { errors: parseErrors })
      }
      const { plan: p, errors: validateErrors } = normalizeAndValidate(raw)
      if (validateErrors.length > 0 || !p) {
        steps.push({ name: 'plan', ok: false, ms: deps.now() - s0 })
        return fail('plan', { errors: validateErrors })
      }
      plan = p
      steps.push({ name: 'plan', ok: true, ms: deps.now() - s0 })

      // --only 过滤(大小写不敏感 + trim):只保留匹配的 case
      if (opts.only != null && opts.only.trim() !== '') {
        const want = opts.only.trim().toLowerCase()
        const matched = plan.cases.filter(c => c.name.trim().toLowerCase() === want)
        if (matched.length === 0) {
          return fail('plan', {
            message: `--only "${opts.only}" 未匹配任何 case`,
            availableCases: plan.cases.map(c => c.name),
          })
        }
        plan = { ...plan, cases: matched }
        subset = true
      }
    }

    // 4. 读 program 文件 + stHash
    {
      const s0 = deps.now()
      // plan.program comes from the (untrusted) plan file — pin it inside the workspace
      // so a malicious `../../etc/passwd` cannot escape the run directory.
      const progPath = safePath(path.resolve(workspaceRoot, plan.program), workspaceRoot)
      try {
        stCode = fs.readFileSync(progPath, 'utf8')
      } catch (e) {
        steps.push({ name: 'program', ok: false, ms: deps.now() - s0 })
        return fail('plan', { errors: [{ path: '$.program', message: `无法读取 program 文件 ${plan.program}: ${String(e)}` }] })
      }
      stHash = stHashOf(stCode)
      steps.push({ name: 'program', ok: true, ms: deps.now() - s0 })
    }

    // 5. 静态预检:预算 + set/when 变量 vs detectIO
    {
      const s0 = deps.now()
      const pb = precheckBudget(plan)
      if (!pb.ok) {
        steps.push({ name: 'precheck', ok: false, ms: deps.now() - s0 })
        return fail('plan', { message: pb.message, estimateMs: pb.estimateMs })
      }
      const io = deps.detectIO(stCode!)
      if (io.count > 0) {  // 无定位声明的程序交给 build 后预检
        const ioNames = new Set(io.io.map(x => x.name.toLowerCase()))
        const missing = [...new Set(collectForcedVars(plan.cases).filter(v => !ioNames.has(v.toLowerCase())))]
        if (missing.length > 0) {
          steps.push({ name: 'precheck', ok: false, ms: deps.now() - s0 })
          return fail('plan', {
            unknownSetVars: missing,
            message: `set/when 变量未在 .st 的定位声明中找到: ${missing.join(', ')}(force 只能作用于定位变量)`,
          })
        }
      }
      steps.push({ name: 'precheck', ok: true, ms: deps.now() - s0 })
    }

    // 6. runtime 可达性
    {
      const s0 = deps.now()
      const st = await deps.status()
      runtimeStatus = st.status
      steps.push({ name: 'status', ok: st.runtimeReachable, ms: deps.now() - s0 })
      if (!st.runtimeReachable) return fail('runtime', { status: st }, ['runtime 不可达——先确认 openplc 容器在运行'])
    }

    // 7. skipBuild 版本校验 / buildAndRun
    if (plan.options!.skipBuild) {
      const s0 = deps.now()
      const stateCode = deps.readStateStCode()
      const ok = stateCode === stCode
      steps.push({ name: 'version-check', ok, ms: deps.now() - s0 })
      if (!ok) {
        return fail('version-conflict', { message: 'runtime 程序与 .st 不一致,去掉 skipBuild 重新编译' })
      }
      built = true
    } else if (deps.readStateStCode() === stCode && runtimeStatus === 'RUNNING') {
      // 自动 build 缓存门:runtime 已加载同一份 ST 且正在 RUNNING → 跳过重编(等价于 skipBuild,
      // 但无需 agent 显式声明)。覆盖"改 timeout/断言、ST 没变就全量重跑"这一最常见的重复编译浪费。
      // RUNNING 这个额外条件保证程序确实处于加载+运行态(case 要读变量/force 活程序);
      // 同码但已 STOPPED 时仍走下面的真 build,由 buildAndRun 重新 upload+start。
      steps.push({ name: 'buildAndRun', ok: true, ms: 0, cached: true })
      built = true
    } else {
      const s0 = deps.now()
      const br = await deps.buildAndRun(stCode!)
      steps.push({ name: 'buildAndRun', ok: br.success, ms: deps.now() - s0 })
      if (!br.success) {
        switch (br.failedStage) {
          case 'compile': return fail('compile', br.compile?.iec2c)
          case 'gcc': return fail('gcc', br.upload)
          // FailureStage 无 'upload':归 'gcc'(同为部署段),detail.note 注明非 GCC
          case 'upload': return fail('gcc', { ...(br.upload ?? {}), note: 'upload 阶段失败(非 GCC)' })
          case 'start': return fail('start', br.start)
          default: return fail('runtime', { agentSummary: br.agentSummary })
        }
      }
      built = true
    }

    // 8. build 后变量名预检(全部 case 变量 vs variableMap)
    {
      const s0 = deps.now()
      const vmap = deps.readVariableMap()
      const known = new Set(vmap.map(v => v.name.toLowerCase()))
      const unknown = [...new Set(collectAllVars(plan.cases).filter(v => !known.has(v.toLowerCase())))]
      steps.push({ name: 'name-precheck', ok: unknown.length === 0, ms: deps.now() - s0 })
      if (unknown.length > 0) {
        return fail('plan', { unknownVars: unknown, nameSuggestions: buildNameSuggestions(unknown, vmap) })
      }
    }

    // 9. case 循环(watchdog + failFast/连接错升级)
    const deadline = t0 + TOTAL_BUDGET_MS - CLEANUP_RESERVE_MS
    let consecutiveConnFails = 0
    for (let i = 0; i < plan.cases.length; i++) {
      const c = plan.cases[i]
      if (deps.now() >= deadline) {
        const rest = plan.cases.slice(i)
        for (const rc of rest) steps.push({ name: `case:${rc.name}`, ok: false, ms: 0, skipped: true })
        if (!failure) {
          fail('timeout', {
            message: `总预算耗尽(硬上限 ${TOTAL_BUDGET_MS}ms − 清理预留 ${CLEANUP_RESERVE_MS}ms),余 ${rest.length} 个工况跳过`,
            skipped: rest.map(x => x.name),
          })
        }
        break
      }
      if (c.resetBefore && deps.start) {
        const s0 = deps.now()
        let resetOk = true
        try {
          await deps.stop()
          await deps.start()
        } catch { resetOk = false }  // 失败不阻断
        steps.push({ name: `reset:${c.name}`, ok: resetOk, ms: deps.now() - s0 })
      }
      const budget = Math.min(plan.options!.perCaseBudgetMs!, deadline - deps.now())
      const r = await deps.runCase(c, budget)
      caseResults.push(r)
      steps.push({ name: `case:${c.name}`, ok: r.ok, ms: r.ms })
      if (r.ok) {
        consecutiveConnFails = 0
        continue
      }
      const connLike = r.stage === 'caseSetup' && CONN_ERROR_RE.test(JSON.stringify(r.detail ?? {}))
      consecutiveConnFails = connLike ? consecutiveConnFails + 1 : 0
      // 连续 2 个连接类 caseSetup → 环境挂了,升级 failFast;或显式 failFast
      if (consecutiveConnFails >= 2 || plan.options!.failFast) {
        for (const rc of plan.cases.slice(i + 1)) steps.push({ name: `case:${rc.name}`, ok: false, ms: 0, skipped: true })
        break
      }
    }
  }

  try {
    await main()
  } catch (e) {
    if (!failure) fail('exception', String(e))
  }

  // ── finalize(必经)──
  // TS 不追踪闭包内赋值,这里取显式注解快照避免 plan 被收窄成 null
  const planSnap = plan as VerifyPlan | null
  // 残留 force 终态清理(per-case 登记的写入由 Task 13 的 caseDeps 接线)
  try { await releaseResidualForces() } catch { /* 不阻断 */ }
  // stopAfter
  try {
    if (planSnap?.options?.stopAfter && built) {
      const sr = await deps.stop({ maxMs: 8000, pollMs: 250 })
      cleanup.stopOk = sr.success
    }
  } catch { cleanup.stopOk = false }

  // case 级失败聚合(首个失败 case 提升到 failure 层;其余进 detail.others)
  // summary 组装——包裹 try 防止 caseOneLiner/JSON.stringify 抛出后吞信封
  let summary: string
  try {
    const failedCases = caseResults.filter(r => !r.ok)
    if (!failure || failure.stage === 'timeout') {
      if (failedCases.length > 0) {
        const f = failedCases[0]
        const others = failedCases.slice(1).map(r => ({ name: r.name, stage: r.stage, summary: caseOneLiner(r) }))
        const timeoutNote = failure?.stage === 'timeout' ? { timeoutAlso: failure.detail } : {}
        failure = {
          stage: f.stage ?? 'assert',
          detail: { ...f.detail, ...(others.length ? { others } : {}), ...timeoutNote },
          ...(f.hints.length ? { hints: f.hints } : {}),
          ...(f.lastFrames ? { lastFrames: f.lastFrames } : {}),
          ...(f.stateTrace ? { stateTrace: f.stateTrace } : {}),
        }
      }
    }

    const total = planSnap?.cases.length ?? 0
    const passed = caseResults.filter(r => r.ok).length
    const buildPart = planSnap?.options?.skipBuild ? '跳过编译(复用运行中程序)' : '编译通过'
    if (!failure) {
      summary = `${buildPart};${passed}/${total} 工况通过`
    } else if (failedCases.length > 0) {
      const f = failedCases[0]
      summary = `${buildPart};${passed}/${total} 工况通过;'${f.name}' 失败(${f.stage}):${caseOneLiner(f)}`
    } else if (failure.stage === 'timeout') {
      summary = `${STAGE_DESC.timeout}:${passed}/${total} 工况已通过,${total - caseResults.length} 个跳过`
    } else {
      summary = STAGE_DESC[failure.stage] ?? failure.stage
    }
    if (subset) summary = `[subset: ${planSnap?.cases[0]?.name ?? '?'}] ${summary}`
  } catch (e) {
    // 聚合段异常降级:保底 summary,信封照常输出
    summary = `结果聚合失败:${e}`
    if (!failure) fail('exception', String(e))
  }

  const envelope: Envelope = {
    ok: !failure,   // 任何失败(含 case 级聚合/timeout)都已落到 failure
    summary: summary!,
    stHash,
    steps,
    ...(failure ? { failure } : {}),
    cleanup,
    artifacts: { runDir: runDirRel },
  }

  // 落盘:runDir(envelope 全量 + plan 副本 + program 快照)+ latest.json;删 lock
  try {
    if (runDirRel) {
      const runDirAbs = safePath(path.join(workspaceRoot, runDirRel), workspaceRoot)
      fs.writeFileSync(safePath(path.join(runDirAbs, 'envelope.json'), workspaceRoot), JSON.stringify(envelope, null, 2))
      if (planText !== null) fs.writeFileSync(safePath(path.join(runDirAbs, 'plan.json'), workspaceRoot), planText)
      if (stCode !== null) fs.writeFileSync(safePath(path.join(runDirAbs, 'program.st'), workspaceRoot), stCode)
    }
  } catch { /* 落盘失败不阻断信封返回 */ }
  // 子集运行不写 latest.json:它是迭代辅助,不能冒充全量签收(buildSimulation
  // 版本门读 latest.json,必须由一次全量 verify 的 ok:true 才放行出图)。
  if (!subset) {
    try {
      fs.mkdirSync(plcActDir, { recursive: true })
      fs.writeFileSync(safePath(path.join(plcActDir, 'latest.json'), workspaceRoot), JSON.stringify({ stHash, ok: envelope.ok, ts: new Date().toISOString() }))
    } catch { /* 同上 */ }
  }
  try { fs.rmSync(lockPath, { force: true }) } catch { /* 同上 */ }

  return { envelope, exitCode: 0 }
}

// ═══════════════════════ parallel(spec 2026-06-16)═══════════════════════
// poolSize>1 且 !options.serial 时走此路径;上面的 serial runVerify 完全不受影响。
// 差异:compileOnce 一次 → 并行部署各实例 → worker-pool 把工况扇到实例 → 显式聚合。

export interface CompileOnceResult {
  ok: boolean
  zipBuffer?: Buffer          // matiec 产物(host Buffer),分发给各实例 uploadZip
  expectedMd5?: string        // md5(ST 源码)——== runtime 0x45 live md5(Phase 2 硬门用)
  failStage?: 'compile' | 'gcc'
  detail?: unknown
}
export interface DeployResult {
  ok: boolean
  failStage?: 'gcc' | 'start' | 'version-conflict'  // version-conflict = 换载后 md5 仍不符
  detail?: unknown
}
export interface ParallelRunnerDeps {
  instances: Instance[]
  status: (inst: Instance) => Promise<StatusResult>
  compileOnce: (stCode: string) => Promise<CompileOnceResult>
  deploy: (co: CompileOnceResult, inst: Instance) => Promise<DeployResult>
  runCase: (c: PlanCase, budgetMs: number, inst: Instance) => Promise<CaseRunResult>
  // amnesty + 终态清理:遍历所有 active-forces*.json,各用对应实例 client release。
  releaseResidual: () => Promise<{ released: string[]; releaseFailed: string[] }>
  stop: (inst: Instance, opts?: { maxMs?: number; pollMs?: number }) => Promise<StartStopResult>
  detectIO: (stCode: string) => DetectIOResult
  readVariableMap: () => VariableEntry[]
  now: () => number
}

type CaseSlot = CaseRunResult & { skipped?: boolean }

export async function runVerifyParallel(
  planPath: string,
  workspaceRoot: string,
  deps: ParallelRunnerDeps,
  opts: { only?: string } = {},
): Promise<{ envelope: Envelope; exitCode: number }> {
  const t0 = deps.now()
  const steps: EnvelopeStep[] = []
  const cleanup: Envelope['cleanup'] = { released: [], releaseFailed: [], stopOk: null }
  let caseResults: CaseSlot[] = []        // dense,按 plan 声明序;skipped = 占位(无稀疏洞)
  let failure: Envelope['failure'] | undefined
  let plan: VerifyPlan | null = null
  let subset = false
  let planText: string | null = null
  let stCode: string | null = null
  let stHash: string | null = null
  let runDirRel: string | null = null
  let deployed: Instance[] = []

  const plcActDir = safePath(path.join(workspaceRoot, '.plc-act'), workspaceRoot)
  const lockPath = safePath(path.join(plcActDir, 'running.lock'), workspaceRoot)

  function fail(stage: FailureStage, detail?: unknown, hints?: string[]): void {
    failure = { stage, ...(detail !== undefined ? { detail } : {}), ...(hints?.length ? { hints } : {}) }
  }

  async function main(): Promise<void> {
    // 1. dir + runDir + lock
    fs.mkdirSync(plcActDir, { recursive: true })
    runDirRel = ['.plc-act', 'runs', new Date().toISOString().replace(/[:.]/g, '-')].join('/')
    fs.mkdirSync(safePath(path.join(workspaceRoot, runDirRel), workspaceRoot), { recursive: true })
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, planPath }))

    // 2. amnesty(遍历所有实例台账)
    {
      const s0 = deps.now()
      const r = await deps.releaseResidual()
      cleanup.released.push(...r.released)
      cleanup.releaseFailed.push(...r.releaseFailed)
      if (r.released.length + r.releaseFailed.length > 0) steps.push({ name: 'amnesty', ok: r.releaseFailed.length === 0, ms: deps.now() - s0 })
    }

    // 3. plan 解析 + 校验(+ --only 子集)
    {
      const s0 = deps.now()
      try { planText = fs.readFileSync(safePath(planPath), 'utf8') }
      catch (e) { steps.push({ name: 'plan', ok: false, ms: deps.now() - s0 }); return fail('plan', { errors: [{ path: planPath, message: `无法读取 plan 文件: ${String(e)}` }] }) }
      const { raw, errors: parseErrors } = parsePlanText(planText)
      if (parseErrors.length > 0) { steps.push({ name: 'plan', ok: false, ms: deps.now() - s0 }); return fail('plan', { errors: parseErrors }) }
      const { plan: p, errors: validateErrors } = normalizeAndValidate(raw)
      if (validateErrors.length > 0 || !p) { steps.push({ name: 'plan', ok: false, ms: deps.now() - s0 }); return fail('plan', { errors: validateErrors }) }
      plan = p
      steps.push({ name: 'plan', ok: true, ms: deps.now() - s0 })
      if (opts.only != null && opts.only.trim() !== '') {
        const want = opts.only.trim().toLowerCase()
        const matched = plan.cases.filter(c => c.name.trim().toLowerCase() === want)
        if (matched.length === 0) return fail('plan', { message: `--only "${opts.only}" 未匹配任何 case`, availableCases: plan.cases.map(c => c.name) })
        plan = { ...plan, cases: matched }
        subset = true
      }
    }

    // 4. 读 program + stHash
    {
      const s0 = deps.now()
      const progPath = safePath(path.resolve(workspaceRoot, plan.program), workspaceRoot)
      try { stCode = fs.readFileSync(progPath, 'utf8') }
      catch (e) { steps.push({ name: 'program', ok: false, ms: deps.now() - s0 }); return fail('plan', { errors: [{ path: '$.program', message: `无法读取 program 文件 ${plan.program}: ${String(e)}` }] }) }
      stHash = stHashOf(stCode)
      steps.push({ name: 'program', ok: true, ms: deps.now() - s0 })
    }

    // 5. 静态预检(墙钟预算 + set/when 变量)
    {
      const s0 = deps.now()
      const pb = precheckBudget(plan, deps.instances.length)
      if (!pb.ok) { steps.push({ name: 'precheck', ok: false, ms: deps.now() - s0 }); return fail('plan', { message: pb.message, estimateMs: pb.estimateMs }) }
      const io = deps.detectIO(stCode!)
      if (io.count > 0) {
        const ioNames = new Set(io.io.map(x => x.name.toLowerCase()))
        const missing = [...new Set(collectForcedVars(plan.cases).filter(v => !ioNames.has(v.toLowerCase())))]
        if (missing.length > 0) { steps.push({ name: 'precheck', ok: false, ms: deps.now() - s0 }); return fail('plan', { unknownSetVars: missing, message: `set/when 变量未在 .st 的定位声明中找到: ${missing.join(', ')}(force 只能作用于定位变量)` }) }
      }
      steps.push({ name: 'precheck', ok: true, ms: deps.now() - s0 })
    }

    // 6. runtime 可达性(各实例;全不可达 → fail)
    let reachable: Instance[] = []
    {
      const s0 = deps.now()
      const sts = await Promise.allSettled(deps.instances.map(i => deps.status(i)))
      reachable = deps.instances.filter((_, k) => sts[k].status === 'fulfilled' && (sts[k] as PromiseFulfilledResult<StatusResult>).value.runtimeReachable)
      steps.push({ name: 'status', ok: reachable.length > 0, ms: deps.now() - s0 })
      if (reachable.length === 0) return fail('runtime', {}, ['池中无可达实例——先确认池容器在运行'])
    }

    // 7. compileOnce + 并行部署
    {
      const s0 = deps.now()
      const co = await deps.compileOnce(stCode!)
      if (!co.ok) { steps.push({ name: 'compile', ok: false, ms: deps.now() - s0 }); return fail(co.failStage === 'gcc' ? 'gcc' : 'compile', co.detail) }
      steps.push({ name: 'compile', ok: true, ms: deps.now() - s0 })

      const used = reachable.slice(0, Math.min(plan.cases.length || 1, reachable.length))
      const s1 = deps.now()
      const settled = await Promise.allSettled(used.map(i => deps.deploy(co, i)))
      deployed = used.filter((_, k) => settled[k].status === 'fulfilled' && (settled[k] as PromiseFulfilledResult<DeployResult>).value.ok)
      const notDeployed = used.filter(i => !deployed.includes(i))
      const rb = await Promise.allSettled(notDeployed.map(i => deps.stop(i, { maxMs: 5000 })))
      const rbFailed = notDeployed.filter((_, k) => rb[k].status === 'rejected' || (rb[k].status === 'fulfilled' && !(rb[k] as PromiseFulfilledResult<StartStopResult>).value.success)).map(i => `#${i.id}`)
      if (rbFailed.length > 0) cleanup.rollbackFailed = rbFailed
      steps.push({ name: 'deploy', ok: deployed.length > 0, ms: deps.now() - s1 })
      if (deployed.length === 0) {
        const firstFail = settled.find(r => r.status === 'fulfilled' && !(r as PromiseFulfilledResult<DeployResult>).value.ok) as PromiseFulfilledResult<DeployResult> | undefined
        return fail(firstFail?.value.failStage ?? 'gcc', { message: '所有实例部署失败', deployFail: firstFail?.value.detail })
      }
    }

    // 8. build 后变量名预检
    {
      const s0 = deps.now()
      const vmap = deps.readVariableMap()
      const known = new Set(vmap.map(v => v.name.toLowerCase()))
      const unknown = [...new Set(collectAllVars(plan.cases).filter(v => !known.has(v.toLowerCase())))]
      steps.push({ name: 'name-precheck', ok: unknown.length === 0, ms: deps.now() - s0 })
      if (unknown.length > 0) return fail('plan', { unknownVars: unknown, nameSuggestions: buildNameSuggestions(unknown, vmap) })
    }

    // 9. worker-pool 扇出 + 显式聚合/failure
    {
      const deadline = t0 + TOTAL_BUDGET_MS - CLEANUP_RESERVE_MS
      const unhealthy = new Set<number>()
      const perCaseBudget = plan.options!.perCaseBudgetMs!
      const isConnFail = (r: CaseRunResult | undefined): boolean =>
        !!r && !r.ok && r.stage === 'caseSetup' && CONN_ERROR_RE.test(JSON.stringify(r.detail ?? {}))
      const runOnInstance = async (c: PlanCase, inst: Instance): Promise<CaseRunResult> => {
        const r = await deps.runCase(c, Math.min(perCaseBudget, deadline - deps.now()), inst)
        if (isConnFail(r)) unhealthy.add(inst.id)
        return r
      }
      const opts9 = (failFast: boolean) => ({ now: deps.now, deadline: () => deadline, failFast, isFailure: (r: CaseRunResult) => !r.ok, isHealthy: (i: Instance) => !unhealthy.has(i.id) })
      const raw = await runWithPool<PlanCase, CaseRunResult>(deployed, plan.cases, runOnInstance, opts9(plan.options!.failFast!))

      // #3 重派:因实例死亡(连接错)失败的 case → 健康实例上再跑一轮(只重派死亡导致的,不碰真断言失败)。
      const healthy = deployed.filter(i => !unhealthy.has(i.id))
      const redispatchIdx = plan.cases.map((_, i) => i).filter(i => isConnFail(raw[i]))
      if (healthy.length > 0 && redispatchIdx.length > 0 && deps.now() < deadline) {
        const retry = await runWithPool<PlanCase, CaseRunResult>(healthy, redispatchIdx.map(i => plan!.cases[i]), runOnInstance, opts9(false))
        redispatchIdx.forEach((origI, k) => { if (retry[k] !== undefined) raw[origI] = retry[k] })
        steps.push({ name: `redispatch:${redispatchIdx.length}个→健康×${healthy.length}`, ok: true, ms: 0 })
      }

      // 填充 dense caseResults(skipped 显式占位,无稀疏洞)
      caseResults = plan.cases.map((c, i) => raw[i] ?? ({ name: c.name, ok: false, ms: 0, stage: null, detail: {}, hints: [], skipped: true } as CaseSlot))
      plan.cases.forEach((c, i) => {
        const r = raw[i]
        steps.push(r ? { name: `case:${c.name}`, ok: r.ok, ms: r.ms } : { name: `case:${c.name}`, ok: false, ms: 0, skipped: true })
      })
      // 显式 failure(杜绝假成功):全 unhealthy → runtime;有 skipped 且预算耗尽 → timeout
      const completed = caseResults.filter(r => !r.skipped)
      if (deployed.length - unhealthy.size === 0 && unhealthy.size > 0) {
        if (!failure) fail('runtime', { message: '所有部署实例在执行中变为不可达', unhealthy: [...unhealthy] })
      } else if (completed.length < plan.cases.length && deps.now() >= deadline) {
        if (!failure) fail('timeout', { message: `墙钟预算耗尽,余 ${plan.cases.length - completed.length} 个工况跳过`, skipped: caseResults.filter(r => r.skipped).map(r => r.name) })
      }
    }
  }

  try { await main() } catch (e) { if (!failure) fail('exception', String(e)) }

  // ── finalize ──
  const planSnap = plan as VerifyPlan | null
  try { const r = await deps.releaseResidual(); cleanup.released.push(...r.released); cleanup.releaseFailed.push(...r.releaseFailed) } catch { /* 不阻断 */ }
  try {
    if (planSnap?.options?.stopAfter && deployed.length > 0) {
      const srs = await Promise.allSettled(deployed.map(i => deps.stop(i, { maxMs: 8000, pollMs: 250 })))
      cleanup.stopOk = srs.every(r => r.status === 'fulfilled' && r.value.success)
    }
  } catch { cleanup.stopOk = false }

  // case 级失败聚合(首失败按 plan 声明序——caseResults 已按下标存,filter 保序)
  let summary: string
  try {
    const realFailed = caseResults.filter(r => !r.ok && !r.skipped)
    if (!failure || failure.stage === 'timeout') {
      if (realFailed.length > 0) {
        const f = realFailed[0]
        const others = realFailed.slice(1).map(r => ({ name: r.name, stage: r.stage, summary: caseOneLiner(r) }))
        const timeoutNote = failure?.stage === 'timeout' ? { timeoutAlso: failure.detail } : {}
        failure = { stage: f.stage ?? 'assert', detail: { ...f.detail, ...(others.length ? { others } : {}), ...timeoutNote }, ...(f.hints.length ? { hints: f.hints } : {}), ...(f.lastFrames ? { lastFrames: f.lastFrames } : {}), ...(f.stateTrace ? { stateTrace: f.stateTrace } : {}) }
      }
    }
    const total = planSnap?.cases.length ?? 0
    const passed = caseResults.filter(r => r.ok).length
    const skippedN = total - caseResults.filter(r => !r.skipped).length
    if (!failure) summary = `编译通过;${passed}/${total} 工况通过(并行 ${deployed.length} 实例)`
    else if (realFailed.length > 0) { const f = realFailed[0]; summary = `编译通过;${passed}/${total} 工况通过;'${f.name}' 失败(${f.stage}):${caseOneLiner(f)}` }
    else if (failure.stage === 'timeout') summary = `${STAGE_DESC.timeout}:${passed}/${total} 工况已通过,${skippedN} 个跳过`
    else summary = STAGE_DESC[failure.stage] ?? failure.stage
    if (subset) summary = `[subset: ${planSnap?.cases[0]?.name ?? '?'}] ${summary}`
  } catch (e) { summary = `结果聚合失败:${e}`; if (!failure) fail('exception', String(e)) }

  const passedFinal = caseResults.filter(r => r.ok).length
  const totalFinal = planSnap?.cases.length ?? 0
  const envelope: Envelope = {
    ok: !failure && passedFinal === totalFinal,
    summary: summary!,
    stHash,
    steps,
    ...(failure ? { failure } : {}),
    cleanup,
    artifacts: { runDir: runDirRel },
  }

  try {
    if (runDirRel) {
      const runDirAbs = safePath(path.join(workspaceRoot, runDirRel), workspaceRoot)
      fs.writeFileSync(safePath(path.join(runDirAbs, 'envelope.json'), workspaceRoot), JSON.stringify(envelope, null, 2))
      if (planText !== null) fs.writeFileSync(safePath(path.join(runDirAbs, 'plan.json'), workspaceRoot), planText)
      if (stCode !== null) fs.writeFileSync(safePath(path.join(runDirAbs, 'program.st'), workspaceRoot), stCode)
    }
  } catch { /* 落盘失败不阻断 */ }
  if (!subset) {
    try { fs.mkdirSync(plcActDir, { recursive: true }); fs.writeFileSync(safePath(path.join(plcActDir, 'latest.json'), workspaceRoot), JSON.stringify({ stHash, ok: envelope.ok, ts: new Date().toISOString() })) } catch { /* 同上 */ }
  }
  try { fs.rmSync(lockPath, { force: true }) } catch { /* 同上 */ }

  return { envelope, exitCode: 0 }
}
