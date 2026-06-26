// tests/block-read.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ReadBlock } from '../src/components/left/blocks/tools/ReadBlock'
afterEach(cleanup)

describe('ReadBlock', () => {
  it('shows file name (collapsed body by default)', () => {
    const { container } = render(<ReadBlock data={{ toolName: 'view_file', input: { file_path: '/x/plan.md' }, status: 'success', result: { ok: true, content: '     1\t# Title' } }} />)
    expect(container.textContent).toContain('plan.md')
  })
})
