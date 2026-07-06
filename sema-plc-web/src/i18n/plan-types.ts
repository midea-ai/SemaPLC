export type Op = '==' | '!=' | '>' | '>=' | '<' | '<='
export type Scalar = number | boolean | string

export interface Expect { var: string; op: Op; value: Scalar }

export interface ShapeExpect {
  var: string
  kind: 'cycle' | 'range' | 'settle' | 'changed'
  sequence?: Scalar[]
  min?: number; max?: number
  tailRatio?: number
}

export interface PlanOptions {
  perCaseBudgetMs?: number
  stopAfter?: boolean
  failFast?: boolean
  skipBuild?: boolean
}

interface CaseBase { name: string; resetBefore?: boolean }

export interface SteadyCase extends CaseBase {
  type: 'steady'
  set: Record<string, Scalar>
  expect: Expect[]
  settleMs?: number
  pulseScans?: number
  when?: Expect & { timeoutMs?: number }
}

export interface TraceCase extends CaseBase {
  type: 'trace'
  vars: string[]
  durationMs: number
  intervalMs?: number
  set?: Record<string, Scalar>
  expectShape: ShapeExpect[]
}

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

export interface VerifyPlan { program: string; options?: PlanOptions; cases: PlanCase[] }
