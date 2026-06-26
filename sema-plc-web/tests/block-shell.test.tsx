// tests/block-shell.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ShellBlock } from '../src/components/left/blocks/tools/ShellBlock'
afterEach(cleanup)

describe('ShellBlock', () => {
  it('shows command and stream output', () => {
    const { container } = render(<ShellBlock data={{ toolName: 'run_shell', input: { command: 'ls -la', description: 'list' }, streamText: 'file1\nfile2\n', status: 'success', result: { ok: true, content: '' } }} />)
    const t = container.textContent || ''
    expect(t).toContain('ls -la'); expect(t).toContain('file2')
  })
})
