// tests/block-skill.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { SkillBlock } from '../src/components/left/blocks/tools/SkillBlock'
afterEach(cleanup)

describe('SkillBlock', () => {
  it('shows skill name', () => {
    const { container } = render(<SkillBlock data={{ toolName: 'skill', input: { skill: 'plc-build-and-verify', args: 'x' }, status: 'success', result: { ok: true, content: 'Activating skill: plc-build-and-verify' } }} />)
    expect(container.textContent).toContain('plc-build-and-verify')
  })
})
