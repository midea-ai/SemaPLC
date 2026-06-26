import { describe, it, expect, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CodeEditor } from '../src/components/center/CodeEditor'

describe('CodeEditor', () => {
  it('把 value 渲染进 CodeMirror 文档', () => {
    const { container } = render(<CodeEditor value={'PROGRAM main'} language="st" onChange={() => {}} />)
    expect(container.querySelector('.cm-content')?.textContent).toContain('PROGRAM main')
    cleanup()
  })

  it('外部 value 变更同步到编辑器,且不回灌 onChange(无回环)', () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<CodeEditor value={'A'} language="st" onChange={onChange} />)
    rerender(<CodeEditor value={'B'} language="st" onChange={onChange} />)
    expect(container.querySelector('.cm-content')?.textContent).toContain('B')
    expect(onChange).not.toHaveBeenCalled()
    cleanup()
  })
})
