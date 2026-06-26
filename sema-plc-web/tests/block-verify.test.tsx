// tests/block-verify.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { VerifyBlock } from '../src/components/left/blocks/tools/VerifyBlock'
afterEach(cleanup)
const PASS = JSON.stringify({ success: true, forced: [{ name: 'sensor_ent', value: true }], forceFailed: [], expect: { matched: true, finalValue: true, timedOut: false, elapsedMs: 316, polls: 2, errorMessage: null }, released: ['sensor_ent'], verdict: '✓ 行为验证通过' })

describe('VerifyBlock', () => {
  it('shows pass verdict and expect detail', () => {
    const { container } = render(<VerifyBlock data={{ toolName: 'mcp__plc-tools__plc_verifyBehavior', status: 'success', result: { ok: true, content: PASS } }} />)
    const t = container.textContent || ''
    expect(t).toContain('通过')
    expect(t).toContain('316')   // elapsedMs
  })
})
