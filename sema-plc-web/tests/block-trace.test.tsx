// tests/block-trace.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TraceBlock } from '../src/components/left/blocks/tools/TraceBlock'
afterEach(cleanup)
const OK = JSON.stringify({
  success: true,
  columns: ['sensor', 'state'],
  meta: { sensor: { type: 'BOOL', index: 0, location: '%IX0.0' }, state: { type: 'INT', index: 1, location: '' } },
  samples: [
    { elapsedMs: 65, tick: 1, values: [true, 0] },
    { elapsedMs: 165, tick: 2, values: [false, 1] },
  ],
})

describe('TraceBlock', () => {
  it('renders a time-series table (cols=columns, rows=samples)', () => {
    const { container } = render(<TraceBlock data={{ toolName: 'mcp__plc-tools__plc_trace', status: 'success', result: { ok: true, content: OK } }} />)
    const t = container.textContent || ''
    expect(t).toContain('sensor'); expect(t).toContain('state'); expect(t).toContain('165')
  })
  it('falls back gracefully when truncated', () => {
    const { container } = render(<TraceBlock data={{ toolName: 'mcp__plc-tools__plc_trace', status: 'success', result: { ok: true, content: '{"samples":[', truncated: true, rawBytes: 40000 } }} />)
    expect(container.textContent).toContain('已截断')
  })
})
