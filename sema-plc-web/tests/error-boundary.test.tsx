import { render, cleanup, fireEvent } from '@testing-library/react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { useState } from 'react'
import { ErrorBoundary } from '../src/components/ErrorBoundary'

afterEach(cleanup)

function Boom({ when }: { when: boolean }) {
  if (when) throw new Error('boom-render')
  return <div>ok-content</div>
}

describe('ErrorBoundary', () => {
  it('子组件 render 抛错 → 显示兜底(不冒泡/不白屏),含 label + 错误信息', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <ErrorBoundary label="测试面板"><Boom when={true} /></ErrorBoundary>,
    )
    expect(container.textContent).toMatch(/测试面板/)
    expect(container.textContent).toMatch(/boom-render/)
    expect(container.textContent).not.toMatch(/ok-content/)
    spy.mockRestore()
  })

  it('正常子组件原样渲染(无侵入)', () => {
    const { container } = render(
      <ErrorBoundary><Boom when={false} /></ErrorBoundary>,
    )
    expect(container.textContent).toMatch(/ok-content/)
  })

  it('点「重试」清错误态:上游修好(不再抛)后可恢复,无需整页刷新', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Harness() {
      const [boom, setBoom] = useState(true)
      return (
        <>
          <button onClick={() => setBoom(false)}>fix</button>
          <ErrorBoundary><Boom when={boom} /></ErrorBoundary>
        </>
      )
    }
    const { container, getByText } = render(<Harness />)
    expect(container.textContent).toMatch(/boom-render/)
    fireEvent.click(getByText('fix'))      // 上游修好 scene(boom=false)
    fireEvent.click(getByText('重试'))      // 重置边界 → 用当前 children 重渲
    expect(container.textContent).toMatch(/ok-content/)
    spy.mockRestore()
  })
})
