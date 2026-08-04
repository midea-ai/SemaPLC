import { useEffect, useRef, useState, memo } from 'react'
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
 *  reads better as a linear list in the order steps were created. */
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

// 执行计划指示器 — 固定在对话栏右上方。处理中显示齿轮+进度(点开看详情),
// 任务全部完成后收成一个绿 ✓,不再每轮在聊天流里铺开占地方。
// memo: ChatPanel 订阅 messages 会在每个 token delta 重渲染,但本组件的输入(processing/todos)
// 只在状态变化时改引用 → memo 跳过绝大多数 token 重渲染,避免每 token 重跑 todoSteps(sort+map)。
export const PlanIndicator = memo(function PlanIndicator({ processing, todos }: { processing: boolean; todos: TodoItem[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const prevProc = useRef(false)
  const steps = todoSteps(todos, t)

  // 处理开始 → 自动展开看实时进度;结束 → 自动收起(用户中途手动开/关仍被尊重,只在边沿触发)。
  useEffect(() => {
    if (processing && !prevProc.current) setOpen(true)
    else if (!processing && prevProc.current) setOpen(false)
    prevProc.current = processing
  }, [processing])

  // 点外部关闭弹层
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (steps.length === 0) return null
  const doneCount = steps.filter((s) => s.status === 'done').length
  const allDone = doneCount === steps.length
  const done = allDone && !processing

  return (
    <div className="plan-indicator" ref={ref}>
      <button
        type="button"
        className={'plan-ind-btn' + (done ? ' done' : processing ? ' busy' : '')}
        onClick={() => setOpen((o) => !o)}
        title={t('plan.title')}
        aria-expanded={open}
      >
        {done ? (
          <span className="plan-ind-ic check">
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        ) : (
          <span className="plan-ind-ic gear">
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 5.2A2.8 2.8 0 108 10.8 2.8 2.8 0 008 5.2Zm6.4 3.6.1-.8-.1-.8 1.4-1.1-1.4-2.4-1.7.6-1.3-.8-.3-1.8H7.9l-.3 1.8-1.3.8-1.7-.6L3.2 6l1.4 1.1-.1.8.1.8L3.2 9.8l1.4 2.4 1.7-.6 1.3.8.3 1.8h2.2l.3-1.8 1.3-.8 1.7.6 1.4-2.4z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
          </span>
        )}
        <span className="plan-ind-label">{t('plan.label')}</span>
        <span className="plan-ind-count">{doneCount}/{steps.length}</span>
      </button>
      {open && (
        <div className="plan-popover">
          <div className="plan-pop-head">
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
      )}
    </div>
  )
})
