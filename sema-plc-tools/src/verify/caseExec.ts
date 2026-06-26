import { judgeShape } from './shapes.js'
import type { PlanCase, SteadyCase, TraceCase, RecordCase, SequenceCase, Scalar, LastFrames } from './planTypes.js'
import type { ForceVariablesInput, ForceVariablesResult, VerifyBehaviorInput, VerifyBehaviorResult,
  WaitForInput, WaitForResult, TraceInput, TraceResult, RecordInput, RecordResult, ReadVariablesResult } from '../types.js'
import { compare } from '../tools/waitFor.js'

export interface CaseRunResult {
  name: string
  ok: boolean
  ms: number
  stage: 'caseSetup' | 'assert' | null      // 分诊:驱动未成立 ≠ 真断言失败(spec §3)
  detail: Record<string, unknown>
  hints: string[]
  lastFrames?: LastFrames
  // assert 失败时全量变量的紧凑变化轨迹(变化过的内部状态 + 失败的断言量),
  // 让 agent 看见"为什么输出错"而非只看见"输出错了"。字符串形态,过信封不被数组帽截。
  stateTrace?: string
}

// runner 注入的、已绑 cfg 的 handler 面 + force 登记回调(SIGKILL-safe:先登记后 force)
export interface CaseDeps {
  force: (i: ForceVariablesInput) => Promise<ForceVariablesResult>
  verifyBehavior: (i: VerifyBehaviorInput, budgetMs: number) => Promise<VerifyBehaviorResult>
  waitFor: (i: WaitForInput, budgetMs: number) => Promise<WaitForResult>
  trace: (i: TraceInput, maxWallMs: number) => Promise<TraceResult>
  record: (i: RecordInput) => Promise<RecordResult>
  readVariables: (names: string[]) => Promise<ReadVariablesResult>
  registerForces: (names: string[]) => void
  unregisterForces: (names: string[]) => void
  budgetMs: number
  now: () => number
}

// 采全量变量(不传 varNames → handleTrace 采整个 variableMap)。OpenPLC 的 debug 读
// 一次返回所有变量,所以采全量与采几个被断言量同成本,白拿全部内部状态。
async function snapshotFull(deps: CaseDeps): Promise<LastFrames | undefined> {
  try {
    const t = await deps.trace({ intervalMs: 200, samples: 5 }, 3_000)
    if (!t.success || t.samples.length === 0) return undefined
    return { columns: t.columns, rows: t.samples.map(s => s.values) }
  } catch { return undefined }
}

const fmtVal = (v: Scalar): string => typeof v === 'boolean' ? (v ? 'T' : 'F') : String(v)

// 取某列的非空值序列(压缩连续重复)
function colSeq(frames: LastFrames, col: number): string[] {
  const seq: string[] = []
  for (const r of frames.rows) {
    const x = r[col]
    if (x === null) continue
    const s = fmtVal(x)
    if (seq[seq.length - 1] !== s) seq.push(s)
  }
  return seq
}

// 把失败窗口内"变化过的内部变量 + 失败的断言量"压成一行紧凑摘要(字符串)。
function buildStateTrace(full: LastFrames | undefined, failedVars: string[]): string | undefined {
  if (!full || full.rows.length === 0) return undefined
  const failedSet = new Set(failedVars.map(v => v.toLowerCase()))
  const parts: string[] = []
  full.columns.forEach((col, i) => {
    const seq = colSeq(full, i)
    if (seq.length === 0) return
    const isFailed = failedSet.has(col.toLowerCase())
    if (seq.length > 1) parts.push(`${isFailed ? '[断言] ' : ''}${col}: ${seq.join('→')}`)
    else if (isFailed) parts.push(`[断言失败] ${col}: ${seq[0]}(全程未变)`)
    // 未变化的非断言变量省略(减噪)
  })
  return parts.length ? parts.join(' | ') : undefined
}

// 基于全量采样的准确分诊:输出恒定 + 内部有响应 → 输入已消费、查下游;
// 输出恒定 + 全程无任何变量变化 → 真"未消费/变量名错"。
function deadValueHint(full: LastFrames | undefined, failedVars: string[]): string[] {
  if (!full) return []
  const failedSet = new Set(failedVars.map(v => v.toLowerCase()))
  const responders: string[] = []
  full.columns.forEach((col, i) => {
    if (failedSet.has(col.toLowerCase())) return
    if (colSeq(full, i).length > 1) responders.push(col)
  })
  const hints: string[] = []
  for (const v of failedVars) {
    const col = full.columns.findIndex(c => c.toLowerCase() === v.toLowerCase())
    if (col < 0) continue
    const seq = colSeq(full, col)
    if (seq.length !== 1) continue  // 只对"恒定输出"给提示
    if (responders.length > 0) {
      hints.push(`${v} 恒为 ${seq[0]} 未跟随,但内部有响应(${responders.slice(0, 3).join(', ')} 有变化)——输入已被消费,查从内部状态到 ${v} 的逻辑/时序/传播延迟`)
    } else {
      hints.push(`${v} 末段恒为 ${seq[0]} 且全程无任何变量响应——疑似程序未消费该输入或变量名错(检查 nameSuggestions)`)
    }
  }
  return hints
}

// 把全量帧投影到被断言量(lastFrames 保持窄列,过信封 capDetail 不被截)
function projectFrames(full: LastFrames, vars: string[]): LastFrames {
  const want = vars.map(v => v.toLowerCase())
  const idx = full.columns.map((c, i) => [c, i] as const).filter(([c]) => want.includes(c.toLowerCase()))
  return { columns: idx.map(([c]) => c), rows: full.rows.map(r => idx.map(([, i]) => r[i])) }
}

// assert 失败诊断三件套:窄列 lastFrames + 全量 stateTrace + 准确 hints。一次采全量。
async function assertDiag(deps: CaseDeps, expectVars: string[], failedVars: string[]):
  Promise<{ lastFrames?: LastFrames; stateTrace?: string; hints: string[] }> {
  const full = await snapshotFull(deps)
  return {
    lastFrames: full ? projectFrames(full, expectVars) : undefined,
    stateTrace: buildStateTrace(full, failedVars),
    hints: deadValueHint(full, failedVars),
  }
}

export async function runCase(c: PlanCase, deps: CaseDeps): Promise<CaseRunResult> {
  const t0 = deps.now()
  const done = (r: Omit<CaseRunResult, 'name' | 'ms'>): CaseRunResult => ({ name: c.name, ms: deps.now() - t0, ...r })
  switch (c.type) {
    case 'steady': return runSteady(c, deps, done)
    case 'trace': return runTrace(c, deps, done)
    case 'record': return runRecord(c, deps, done)
    case 'sequence': return runSequence(c, deps, done)
  }
}

async function runSteady(
  c: SteadyCase,
  deps: CaseDeps,
  done: (r: Omit<CaseRunResult, 'name' | 'ms'>) => CaseRunResult,
): Promise<CaseRunResult> {
  const hints: string[] = []
  const setNames = Object.keys(c.set)
  const expectVars = c.expect.map(e => e.var)

  // 污染预检:开跑前断言已成立时发出 hint
  try {
    const preRead = await deps.readVariables(expectVars)
    if (preRead.success) {
      // 建小写键 map 以兼容 matiec 转小写的变量名
      const lcVarMap = Object.fromEntries(
        Object.entries(preRead.variables).map(([k, v]) => [k.toLowerCase(), v])
      )
      const allAlreadyMet = c.expect.every(e => {
        const entry = lcVarMap[e.var.toLowerCase()]
        if (entry === undefined) return false
        return compare(entry.value as Scalar, e.op, e.value)
      })
      if (allAlreadyMet) {
        hints.push('开跑前断言已全部成立——可能被前序 case 污染,或本 case 为负向断言(驱动前后无区分力);建议加 "resetBefore": true 或补正向断言')
      }
    }
  } catch {
    // 预检异常不阻断
  }

  deps.registerForces(setNames)
  try {
    // when 或 pulseScans 路径
    if (c.when || c.pulseScans) {
      const forceInput: ForceVariablesInput = { set: c.set as Record<string, number | boolean> }
      if (c.when) {
        forceInput.when = {
          varName: c.when.var,
          op: c.when.op,
          value: c.when.value,
          timeoutMs: c.when.timeoutMs,
        }
      }
      if (c.pulseScans) {
        forceInput.pulseScans = c.pulseScans
      }

      const fr = await deps.force(forceInput)

      // when 未触发
      if (c.when && fr.when && !fr.when.met) {
        return done({
          ok: false,
          stage: 'caseSetup',
          detail: { when: fr.when },
          hints: [...hints, `前置工况未成立:when 条件 ${c.when.var} ${c.when.op} ${c.when.value} 在超时内未满足(末值 ${fr.when.conditionValue})。别改程序逻辑,检查驱动条件/时序`],
        })
      }

      // force 未成功
      if (!fr.success) {
        return done({
          ok: false,
          stage: 'caseSetup',
          detail: { forceFailed: fr.failed },
          hints: [...hints, `force 未成功施加:${fr.failed.map(f => `${f.name}(${f.reason})`).join(', ')}。别改程序逻辑,检查驱动条件/时序`],
        })
      }

      // pulse 未 verified
      if (c.pulseScans && fr.pulse && !fr.pulse.verified) {
        return done({
          ok: false,
          stage: 'caseSetup',
          detail: { pulse: fr.pulse },
          hints: [...hints, `pulse 未 verified:scansHeld=${fr.pulse.scansHeld},期望 ${c.pulseScans} 扫描。先看 status 确认 PLC 正在运行`],
        })
      }

      // settle 后逐条 waitFor
      if (c.settleMs && c.settleMs > 0) {
        const actualSettle = Math.min(c.settleMs, deps.budgetMs)
        await new Promise<void>(r => setTimeout(r, actualSettle))
      }

      const failedExpects: Array<{ var: string; op: string; expected: Scalar; actual: Scalar | null }> = []
      const results: Array<{ e: typeof c.expect[number]; r: WaitForResult }> = []
      for (const e of c.expect) {
        const wr = await deps.waitFor({ varName: e.var, op: e.op, value: e.value }, deps.budgetMs)
        results.push({ e, r: wr })
        if (!wr.success) {
          // unresolved/读取失败 → caseSetup,不归 assert
          if (wr.errorMessage) {
            return done({
              ok: false,
              stage: 'caseSetup',
              detail: { errorMessage: wr.errorMessage, nameSuggestion: wr.nameSuggestion ?? null },
              hints: [...hints, `expect 变量名未解析或读取失败——检查变量名(见 nameSuggestion),勿改程序`],
            })
          }
          failedExpects.push({ var: e.var, op: e.op, expected: e.value, actual: wr.finalValue as Scalar | null })
        }
      }

      if (failedExpects.length === 0) {
        return done({ ok: true, stage: null, detail: { expect: results.map(x => x.r) }, hints })
      }

      const diag = await assertDiag(deps, expectVars, failedExpects.map(f => f.var))
      return done({
        ok: false,
        stage: 'assert',
        detail: { failed: failedExpects },
        hints: [...hints, ...diag.hints],
        lastFrames: diag.lastFrames,
        stateTrace: diag.stateTrace,
      })
    }

    // plain 路径 → verifyBehavior
    const vr = await deps.verifyBehavior(
      {
        set: c.set as Record<string, number | boolean>,
        expect: c.expect.map(e => ({ varName: e.var, op: e.op, value: e.value })),
        settleMs: c.settleMs,
      },
      deps.budgetMs,
    )

    // force 失败 → caseSetup
    if (!vr.success && vr.forceFailed.length > 0) {
      return done({
        ok: false,
        stage: 'caseSetup',
        detail: { forceFailed: vr.forceFailed },
        hints: [...hints, `前置工况未成立,勿改程序逻辑:force 失败 ${vr.forceFailed.map(f => `${f.name}(${f.reason})`).join(', ')}`],
      })
    }

    if (vr.success) {
      return done({ ok: true, stage: null, detail: { verdict: vr.verdict }, hints })
    }

    // expect 变量 unresolved → caseSetup
    const expectArr = Array.isArray(vr.expect) ? vr.expect : [vr.expect]
    const unresolvedExpect = expectArr.find(e => e.errorMessage)
    if (unresolvedExpect) {
      return done({
        ok: false,
        stage: 'caseSetup',
        detail: { errorMessage: unresolvedExpect.errorMessage, nameSuggestion: (unresolvedExpect as any).nameSuggestion ?? null },
        hints: [...hints, `expect 变量名未解析或读取失败——检查变量名(见 nameSuggestion),勿改程序`],
      })
    }

    // assert 失败
    const failedVars = expectArr.filter(e => !e.matched).map(e => e.varName)
    const diag = await assertDiag(deps, expectVars, failedVars)
    return done({
      ok: false,
      stage: 'assert',
      detail: { verdict: vr.verdict, expect: vr.expect },
      hints: [...hints, ...diag.hints],
      lastFrames: diag.lastFrames,
      stateTrace: diag.stateTrace,
    })
  } finally {
    await deps.force({ release: setNames }).catch(() => null)
    deps.unregisterForces(setNames)
  }
}

type Done = (r: Omit<CaseRunResult, 'name' | 'ms'>) => CaseRunResult

async function runTrace(
  c: TraceCase,
  deps: CaseDeps,
  done: Done,
): Promise<CaseRunResult> {
  const setNames = Object.keys(c.set ?? {})
  if (setNames.length) deps.registerForces(setNames)
  try {
    if (setNames.length) {
      const fr = await deps.force({ set: c.set! })
      if (!fr.success) {
        return done({ ok: false, stage: 'caseSetup', detail: { forceFailed: fr.failed }, hints: ['trace 前置 force 失败'] })
      }
    }
    const t = await deps.trace(
      { varNames: c.vars, intervalMs: c.intervalMs ?? 200, durationMs: c.durationMs },
      Math.min(c.durationMs + 5_000, deps.budgetMs),
    )
    if (!t.success || t.samples.length === 0 || t.samples.every(s => s.tick === null))
      return done({
        ok: false, stage: 'caseSetup',
        detail: { trace: { errorMessage: t.errorMessage, samples: t.samples.length } },
        hints: ['采样整体失败——runtime 未运行/debug 通道异常,先看 status,别改程序'],
      })
    // 变量名解析失败 → caseSetup(勿归 assert)
    const unresolved = (t.unresolvedNames ?? []) as string[]
    const shapeColMissing = c.expectShape.filter(sh =>
      t.columns.findIndex(x => x.toLowerCase() === sh.var.toLowerCase()) < 0
    ).map(sh => sh.var)
    const allUnresolved = [...new Set([...unresolved, ...shapeColMissing])]
    if (allUnresolved.length > 0) {
      return done({
        ok: false, stage: 'caseSetup',
        detail: { unresolvedNames: allUnresolved, nameSuggestions: (t as any).nameSuggestions ?? [] },
        hints: ['expectShape 变量名未解析——检查变量名,勿改程序'],
      })
    }
    const verdicts = c.expectShape.map(sh => {
      const col = t.columns.findIndex(x => x.toLowerCase() === sh.var.toLowerCase())
      const series = col >= 0 ? t.samples.map(s => s.values[col] ?? null) : []
      return { var: sh.var, kind: sh.kind, ...judgeShape(series, sh) }
    })
    const failed = verdicts.filter(v => !v.ok)
    if (failed.length === 0) return done({ ok: true, stage: null, detail: { shapes: verdicts }, hints: [] })
    const hints: string[] = []
    for (const f of failed) {
      if (f.kind === 'cycle') {
        const obs = (f as any).observed as Scalar[] | undefined
        const obsLen = obs?.length ?? 0
        if (obsLen < 2) {
          hints.push(`${f.var} 折叠后仅 ${JSON.stringify(obs ?? [])}——疑似状态机未运动或驱动未生效,先确认 force 已施加、PLC 在运行`)
        } else if (obs) {
          hints.push(`${f.var} 有轮转但顺序为 ${JSON.stringify(obs)}——先核对期望顺序是否写反(工况错),再查程序`)
        }
      }
    }
    // 全量内部状态轨迹:trace 只采了 agent 选的几个量,bug 常在它没想到 trace 的
    // 内部状态(移位寄存器位置/状态机/计数器)。补一次全量采样,把内部因果链摊开。
    const stateTrace = buildStateTrace(await snapshotFull(deps), failed.map(f => f.var))
    return done({
      ok: false, stage: 'assert',
      detail: { shapes: verdicts, actualIntervalMs: (t as any).actualIntervalMs },
      hints,
      lastFrames: { columns: t.columns, rows: t.samples.slice(-8).map(s => s.values) },
      stateTrace,
    })
  } catch (e) {
    return done({ ok: false, stage: 'caseSetup', detail: { error: String(e) }, hints: ['采样异常——环境问题优先排查'] })
  } finally {
    if (setNames.length) {
      await deps.force({ release: setNames }).catch(() => null)
      deps.unregisterForces(setNames)
    }
  }
}

async function runSequence(
  c: SequenceCase,
  deps: CaseDeps,
  done: Done,
): Promise<CaseRunResult> {
  const t0 = deps.now()
  const steps = c.steps
  const held: string[] = []   // 跨步累积的持有 force(无 pulseScans 的 set)
  const hints: string[] = []

  try {
    for (let j = 0; j < steps.length; j++) {
      const step = steps[j]

      // 预算检查
      if (deps.now() - t0 >= deps.budgetMs) {
        return done({
          ok: false,
          stage: 'caseSetup',
          detail: {
            reason: 'budget',
            failedStep: j,
            skippedSteps: steps.slice(j).map((_, k) => j + k),
            heldForces: [...held],
          },
          hints: ['步预算耗尽——拆分 sequence 或减少步等待'],
        })
      }

      // set 驱动
      if (step.set) {
        const setNames = Object.keys(step.set)
        const isPulse = !!step.pulseScans
        // 仅非 pulse 步的 set 才注册到持有
        // "尝试即持有":register 之后、force 调用之前就入 held,
        // 保证任何失败 return 路径都能在 finally 中清场(release 未施加的变量是无害 no-op)
        if (!isPulse) {
          const newNames = setNames.filter(n => !held.includes(n))
          if (newNames.length) {
            deps.registerForces(newNames)
            for (const n of newNames) held.push(n)
          }
        }

        const forceInput: ForceVariablesInput = {
          set: step.set as Record<string, number | boolean>,
          ...(isPulse ? { pulseScans: step.pulseScans } : {}),
        }
        const fr = await deps.force(forceInput)

        if (!fr.success) {
          return done({
            ok: false,
            stage: 'caseSetup',
            detail: { failedStep: j, heldForces: [...held], forceFailed: fr.failed },
            hints: [`第 ${j} 步 force 未成功:${fr.failed.map(f => `${f.name}(${f.reason})`).join(', ')}。勿改程序,检查驱动条件/时序`],
          })
        }

        if (isPulse && fr.pulse && !fr.pulse.verified) {
          return done({
            ok: false,
            stage: 'caseSetup',
            detail: { failedStep: j, heldForces: [...held], pulse: fr.pulse },
            hints: [`第 ${j} 步 pulse 未 verified:scansHeld=${fr.pulse.scansHeld}——先确认 PLC 正在运行`],
          })
        }
      }

      // settleMs
      if (step.settleMs && step.settleMs > 0) {
        const elapsed = deps.now() - t0
        const remaining = deps.budgetMs - elapsed
        const actualSettle = Math.min(step.settleMs, remaining)
        if (actualSettle > 0) await new Promise<void>(r => setTimeout(r, actualSettle))
      }

      // waitFor(推进确认 → 失败归 caseSetup)
      if (step.waitFor) {
        const wf = step.waitFor
        const wr = await deps.waitFor(
          { varName: wf.var, op: wf.op, value: wf.value, ...(wf.timeoutMs ? { timeoutMs: wf.timeoutMs } : {}) },
          deps.budgetMs,
        )
        if (wr.errorMessage != null) {
          return done({
            ok: false,
            stage: 'caseSetup',
            detail: { failedStep: j, heldForces: [...held], errorMessage: wr.errorMessage, nameSuggestion: (wr as any).nameSuggestion ?? null },
            hints: [`第 ${j} 步 waitFor 变量名未解析——检查变量名(见 nameSuggestion),勿改程序`],
          })
        }
        if (!wr.success) {
          return done({
            ok: false,
            stage: 'caseSetup',
            detail: { failedStep: j, heldForces: [...held], waitFor: wr },
            hints: [`第 ${j} 步推进条件未成立(${wf.var} 末值 ${wr.finalValue})——检查驱动/时序,勿改程序`],
          })
        }
      }

      // expect(真断言 → 失败归 assert)
      if (step.expect && step.expect.length > 0) {
        const failedExpects: Array<{ var: string; op: string; expected: Scalar; actual: Scalar | null }> = []
        for (const e of step.expect) {
          const wr = await deps.waitFor({ varName: e.var, op: e.op, value: e.value }, deps.budgetMs)
          if (wr.errorMessage != null) {
            return done({
              ok: false,
              stage: 'caseSetup',
              detail: { failedStep: j, heldForces: [...held], errorMessage: wr.errorMessage, nameSuggestion: (wr as any).nameSuggestion ?? null },
              hints: [`第 ${j} 步 expect 变量名未解析——检查变量名,勿改程序`],
            })
          }
          if (!wr.success) {
            failedExpects.push({ var: e.var, op: e.op, expected: e.value, actual: wr.finalValue as Scalar | null })
          }
        }
        if (failedExpects.length > 0) {
          const expectVars = step.expect.map(e => e.var)
          const diag = await assertDiag(deps, expectVars, failedExpects.map(f => f.var))
          return done({
            ok: false,
            stage: 'assert',
            detail: { failedStep: j, heldForces: [...held], failed: failedExpects },
            hints: [...hints, ...diag.hints],
            lastFrames: diag.lastFrames,
            stateTrace: diag.stateTrace,
          })
        }
      }
    }

    return done({ ok: true, stage: null, detail: { steps: steps.length }, hints })
  } finally {
    if (held.length) {
      await deps.force({ release: held }).catch(() => null)
      deps.unregisterForces(held)
    }
  }
}

async function runRecord(
  c: RecordCase,
  deps: CaseDeps,
  done: Done,
): Promise<CaseRunResult> {
  const r = await deps.record({
    varNames: c.vars,
    ...(c.fromTick != null ? { fromTick: c.fromTick } : {}),
    ...(c.lastScans != null ? { lastScans: c.lastScans } : {}),
  })
  if (!r.success)
    return done({
      ok: false, stage: 'caseSetup',
      detail: { errorMessage: r.errorMessage },
      hints: ['record 读取失败——环境/runtime 问题'],
    })
  // 变量名解析失败 → caseSetup(勿归 assert)
  const unresolved = (r.unresolvedNames ?? []) as string[]
  const shapeMissing = c.expectShape.filter(sh =>
    !r.series.find(x => x.name.toLowerCase() === sh.var.toLowerCase())
  ).map(sh => sh.var)
  const allUnresolved = [...new Set([...unresolved, ...shapeMissing])]
  if (allUnresolved.length > 0) {
    return done({
      ok: false, stage: 'caseSetup',
      detail: { unresolvedNames: allUnresolved, nameSuggestions: (r as any).nameSuggestions ?? [] },
      hints: ['expectShape 变量名未解析——检查变量名,勿改程序'],
    })
  }
  const verdicts = c.expectShape.map(sh => {
    const s = r.series.find(x => x.name.toLowerCase() === sh.var.toLowerCase())
    const series = s ? [s.first, ...s.transitions.map(([, v]: [unknown, unknown]) => v as Scalar)] : []
    return { var: sh.var, kind: sh.kind, ...judgeShape(series, sh) }
  })
  const failed = verdicts.filter(v => !v.ok)
  if (failed.length === 0) return done({ ok: true, stage: null, detail: { shapes: verdicts, window: r.window }, hints: [] })
  const stateTrace = buildStateTrace(await snapshotFull(deps), failed.map(f => f.var))
  return done({ ok: false, stage: 'assert', detail: { shapes: verdicts, window: r.window, skippedUnrecordable: r.skippedUnrecordable, fullDumpFile: r.fullDumpFile }, hints: [], stateTrace })
}
