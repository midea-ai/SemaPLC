import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PlanIndicator } from '../src/components/left/PlanCard'
import type { TodoItem } from '../shared/protocol'

afterEach(cleanup)

// PlanIndicator 固定在对话栏右上角:有 todo 就显示折叠按钮(齿轮/✓ + 进度),
// 步骤明细在弹层里 —— processing 由 false→true 的边沿自动展开、结束自动收起。
describe('PlanIndicator', () => {
  it('renders real todos (title + progressText) when todos present', () => {
    const todos: TodoItem[] = [
      { id: '1', title: '行为验证', status: 'in_progress', progressText: '正在 force 传感器' },
      { id: '2', title: '过程仿真', status: 'pending' },
    ]
    const { container } = render(<PlanIndicator processing todos={todos} />)
    expect(container.textContent).toContain('行为验证')
    expect(container.textContent).toContain('正在 force 传感器')
    expect(container.textContent).toContain('过程仿真')
  })
  it('renders nothing when there are no todos (no tool-call fallback)', () => {
    const { container } = render(<PlanIndicator processing todos={[]} />)
    expect(container.firstChild).toBeNull()
  })
  it('collapsed when not processing — 进度按钮在,步骤弹层不展开', () => {
    const todos: TodoItem[] = [{ id: '1', title: '行为验证', status: 'in_progress' }]
    const { container } = render(<PlanIndicator processing={false} todos={todos} />)
    expect(container.querySelector('.plan-ind-btn')).not.toBeNull()   // 折叠按钮常驻
    expect(container.querySelector('.plan-popover')).toBeNull()       // 明细不展开
    expect(container.textContent).not.toContain('行为验证')
  })
  it('orders todos by numeric id and maps status (in_progress→进行中, completed→完成)', () => {
    const todos: TodoItem[] = [
      { id: '2', title: '过程仿真', status: 'pending' },
      { id: '1', title: '写 ST 并 verify', status: 'completed' },
    ]
    const { container } = render(<PlanIndicator processing todos={todos} />)
    const text = container.textContent ?? ''
    // id=1 应排在 id=2 之前(创建顺序)
    expect(text.indexOf('写 ST 并 verify')).toBeLessThan(text.indexOf('过程仿真'))
    expect(text).toContain('完成')
  })
})
