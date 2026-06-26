import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ThinkingBlock } from '../src/components/left/blocks/ThinkingBlock'
afterEach(cleanup)

describe('ThinkingBlock', () => {
  it('auto-expands while streaming (body visible)', () => {
    const { container } = render(<ThinkingBlock block={{ kind: 'thinking', id: 'x', text: 'reasoning now', streaming: true }} />)
    expect(container.textContent).toContain('reasoning now')
  })
  it('collapses when done (body hidden)', () => {
    const { container } = render(<ThinkingBlock block={{ kind: 'thinking', id: 'x', text: 'reasoning done', streaming: false, durationMs: 3000 }} />)
    expect(container.textContent).not.toContain('reasoning done')
  })
})
