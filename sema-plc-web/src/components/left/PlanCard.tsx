import './plan-card.css'
import type { TodoItem } from '../../../shared/protocol'
import { useT, type TKey } from '../../i18n'

type StepStatus = 'done' | 'active' | 'error' | 'pending'

interface PlanStep {
  id: string
  label: string
  status: StepStatus
  note: string
}

const TODO_TO_STATUS: Record<TodoItem['status'], StepStatus> = {
  pending: 'pending', in_progress: 'active', completed: 'done',
}
/** Map the agent's real todo list to plan steps; progressText becomes the sub-line.
 *  Sort by numeric id (creation order) — sema-core emits completed-first, but the plan
 *  card reads better as a linear plan in the order steps were created. */
function todoSteps(todos: TodoItem[], t: (key: TKey) => string): PlanStep[] {
  const ordered = [...todos].sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0))
  return ordered.map((todo): PlanStep => {
    const status = TODO_TO_STATUS[todo.status] ?? 'pending'
    return {
      id: todo.id,
      label: todo.title,
      status,
      note: todo.progressText ?? (status === 'done' ? t('plan.note.done') : status === 'active' ? t('plan.note.active') : ''),
    }
  })
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === 'done')
    return (
      <span className="step-ic done">
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
    )
  if (status === 'active')
    return <span className="step-ic active"><span className="step-half" /></span>
  if (status === 'error')
    return (
      <span className="step-ic error">
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" /></svg>
      </span>
    )
  return <span className="step-ic pending" />
}

export function PlanCard({ processing, todos }: { processing: boolean; todos: TodoItem[] }) {
  // 计划卡只反映 agent 的真实 todo 列表。没有 todo 就不显示卡片——绝不拿工具
  // 调用流凑数(旧的 tool_use 兜底会渲染 run_shell/search_files 等管道工具名,
  // CodeAct 改造后那些不再代表有意义的步骤,看起来毫无逻辑)。
  const t = useT()
  const steps = todoSteps(todos, t)
  if (steps.length === 0 || !processing) return null
  const doneCount = steps.filter((s) => s.status === 'done').length

  return (
    <div className="plan-card">
      <div className="plan-head">
        <span className="plan-gear">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.2A2.8 2.8 0 108 10.8 2.8 2.8 0 008 5.2Zm6.4 3.6.1-.8-.1-.8 1.4-1.1-1.4-2.4-1.7.6-1.3-.8-.3-1.8H7.9l-.3 1.8-1.3.8-1.7-.6L3.2 6l1.4 1.1-.1.8.1.8L3.2 9.8l1.4 2.4 1.7-.6 1.3.8.3 1.8h2.2l.3-1.8 1.3-.8 1.7.6 1.4-2.4z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
        </span>
        <span className="plan-title">{t('plan.title')}</span>
        <span className="plan-progress">{doneCount}/{steps.length}</span>
      </div>
      <div className="plan-steps">
        {steps.map((s) => (
          <div key={s.id} className={'plan-step st-' + s.status}>
            <StepIcon status={s.status} />
            <div className="step-main">
              <span className="step-label">{s.label}</span>
              {s.status !== 'pending' && s.note && <span className="step-sub">{s.status === 'error' ? t('plan.note.fixing') : s.note}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
