// tests/block-force.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ForceBlock } from '../src/components/left/blocks/tools/ForceBlock'
afterEach(cleanup)
const RESULT = JSON.stringify({ success: true, forced: [{ name: 'presence_sensor', index: 0, type: 'BOOL', value: 'true' }], released: [], failed: [{ name: 'bad', value: 'x' }], errorMessage: null })

describe('ForceBlock', () => {
  it('shows forced rows and a failed badge', () => {
    const { container } = render(<ForceBlock data={{ toolName: 'mcp__plc-tools__plc_forceVariables', status: 'success', result: { ok: true, content: RESULT } }} />)
    const t = container.textContent || ''
    expect(t).toContain('presence_sensor')
    expect(t).toContain('bad')      // failed
  })
})
