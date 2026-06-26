import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { PlanCard } from '../src/components/left/PlanCard'
import type { TodoItem } from '../shared/protocol'

afterEach(cleanup)

describe('PlanCard', () => {
  it('renders real todos (title + progressText) when todos present', () => {
    const todos: TodoItem[] = [
      { id: '1', title: '行为验证', status: 'in_progress', progressText: '正在 force 传感器' },
      { id: '2', title: '过程仿真', status: 'pending' },
    ]
    const { container } = render(<PlanCard processing todos={todos} />)
    expect(container.textContent).toContain('行为验证')
    expect(container.textContent).toContain('正在 force 传感器')
    expect(container.textContent).toContain('过程仿真')
  })
  it('renders nothing when there are no todos (no tool-call fallback)', () => {
    const { container } = render(<PlanCard processing todos={[]} />)
    expect(container.firstChild).toBeNull()
  })
  it('hidden when not processing', () => {
    const todos: TodoItem[] = [{ id: '1', title: '行为验证', status: 'in_progress' }]
    const { container } = render(<PlanCard processing={false} todos={todos} />)
    expect(container.firstChild).toBeNull()
  })
  it('orders todos by numeric id and maps status (in_progress→进行中, completed→完成)', () => {
    const todos: TodoItem[] = [
      { id: '2', title: '过程仿真', status: 'pending' },
      { id: '1', title: '写 ST 并 verify', status: 'completed' },
    ]
    const { container } = render(<PlanCard processing todos={todos} />)
    const text = container.textContent ?? ''
    // id=1 应排在 id=2 之前(创建顺序)
    expect(text.indexOf('写 ST 并 verify')).toBeLessThan(text.indexOf('过程仿真'))
    expect(text).toContain('完成')
  })
})
