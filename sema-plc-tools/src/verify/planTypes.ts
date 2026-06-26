// Verify-plan 契约 v1 — spec §2。四种 case;pulse/when 是 steady 的修饰字段而非独立类型。
export type Op = '==' | '!=' | '>' | '>=' | '<' | '<='
export type Scalar = number | boolean | string

export interface Expect { var: string; op: Op; value: Scalar }
export interface WhenClause { var: string; op: Op; value: Scalar; timeoutMs?: number }

export interface ShapeExpect {
  var: string
  kind: 'cycle' | 'range' | 'settle' | 'changed'
  sequence?: Scalar[]        // cycle: 期望的轮转顺序
  min?: number; max?: number // range / settle: 区间
  tailRatio?: number         // settle: 末段占比,默认 0.25
}

interface CaseBase { name: string; resetBefore?: boolean }
export interface SteadyCase extends CaseBase {
  type: 'steady'
  set: Record<string, Scalar>
  expect: Expect[]
  settleMs?: number
  pulseScans?: number        // 修饰:tick 验证脉冲(R_TRIG)
  when?: WhenClause          // 修饰:条件触发 force
}
export interface TraceCase extends CaseBase {
  type: 'trace'
  vars: string[]
  durationMs: number
  intervalMs?: number
  set?: Record<string, Scalar>   // trace 期间持有的输入(结束释放)
  expectShape: ShapeExpect[]
}
// 注意:settle shape 在 record 路径按 transitions 序列(变化次数)取末段而非时间窗,高频振荡后收敛的信号慎用
export interface RecordCase extends CaseBase {
  type: 'record'
  vars: string[]
  lastScans?: number
  fromTick?: number
  expectShape: ShapeExpect[]
}
export interface SeqStep {
  set?: Record<string, Scalar>
  pulseScans?: number
  settleMs?: number
  waitFor?: Expect & { timeoutMs?: number }
  expect?: Expect[]
}
export interface SequenceCase extends CaseBase { type: 'sequence'; steps: SeqStep[] }

export type PlanCase = SteadyCase | TraceCase | RecordCase | SequenceCase

export interface PlanOptions {
  perCaseBudgetMs?: number   // default 30_000
  stopAfter?: boolean        // default true
  failFast?: boolean         // default false
  skipBuild?: boolean        // default false — true 时校验 runtime 程序与 .st 一致后复用
  serial?: boolean           // default false — true 时整盘退串行(走 runVerify),即便 poolSize>1
}
export interface VerifyPlan { program: string; options?: PlanOptions; cases: PlanCase[] }

// ── 信封(spec §3)──
export type FailureStage =
  | 'plan' | 'compile' | 'gcc' | 'start' | 'runtime'
  | 'caseSetup' | 'assert' | 'version-conflict' | 'timeout' | 'exception'

export interface EnvelopeStep { name: string; ok: boolean; ms: number; skipped?: boolean; cached?: boolean }
export interface LastFrames { columns: string[]; rows: Array<Array<Scalar | null>> }
export interface Envelope {
  ok: boolean
  summary: string
  stHash: string | null
  steps: EnvelopeStep[]
  failure?: { stage: FailureStage; detail?: unknown; lastFrames?: LastFrames; hints?: string[]; stateTrace?: string }
  cleanup: { released: string[]; releaseFailed: string[]; stopOk: boolean | null; rollbackFailed?: string[] }
  artifacts: { runDir: string | null }
}

export interface PlanError { path: string; message: string; suggestion?: string }
