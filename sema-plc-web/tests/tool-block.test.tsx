import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ToolBlock } from '../src/components/left/blocks/tools/ToolBlock'
import { isHiddenTool } from '../src/components/left/blocks/tools/registry'

afterEach(cleanup)

describe('ToolBlock dispatch', () => {
  it('falls back to generic card for unknown tool', () => {
    const { container } = render(<ToolBlock data={{ toolName: 'mcp__plc-tools__plc_status', status: 'success', result: { ok: true, content: '{"status":"RUNNING"}' } }} />)
    expect(container.textContent).toContain('plc_status')
  })
})

describe('isHiddenTool', () => {
  it('hides todo tools', () => {
    expect(isHiddenTool('create_todo')).toBe(true)
    expect(isHiddenTool('update_todo')).toBe(true)
    expect(isHiddenTool('mcp__plc-tools__plc_readVariables')).toBe(false)
  })
})
