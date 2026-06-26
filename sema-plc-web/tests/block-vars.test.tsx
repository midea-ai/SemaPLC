// tests/block-vars.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { VarsBlock } from '../src/components/left/blocks/tools/VarsBlock'

afterEach(cleanup)
const RESULT = JSON.stringify({
  success: true,
  variables: {
    state: { value: 0, type: 'INT', index: 6, location: '' },
    run_conveyor: { value: true, type: 'BOOL', index: 3, location: '%QX0.1' },
  },
  tick: 375903, unresolvedNames: ['cont'], errorMessage: null,
})

describe('VarsBlock', () => {
  it('renders a variable table with values, types, tick, did-you-mean', () => {
    const { container } = render(<VarsBlock data={{ toolName: 'mcp__plc-tools__plc_readVariables', status: 'success', result: { ok: true, content: RESULT } }} />)
    const t = container.textContent || ''
    expect(t).toContain('run_conveyor')
    expect(t).toContain('%QX0.1')
    expect(t).toContain('375903')   // tick
    expect(t).toContain('cont')     // unresolvedNames did-you-mean
  })
})
