import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MarkdownText } from '../src/components/left/blocks/MarkdownText'
afterEach(cleanup)

describe('MarkdownText', () => {
  it('clamps very long text with a 展开 control', () => {
    const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n\n')
    const { container } = render(<MarkdownText text={long} />)
    expect(container.textContent).toContain('展开')
  })
  it('short text renders without 展开', () => {
    const { container } = render(<MarkdownText text={'hello'} />)
    expect(container.textContent).not.toContain('展开')
  })
})
