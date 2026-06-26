// tests/block-edit.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { EditBlock } from '../src/components/left/blocks/tools/EditBlock'
afterEach(cleanup)
const RESULT = 'Successfully edited /tmp/ws/src/programs/conveyor.st. Below is the updated snippet with line numbers:\n     3\t    presence_sensor AT %IX0.0 : BOOL;\n     4\t  END_VAR'

describe('EditBlock', () => {
  it('shows file name and the numbered result snippet', () => {
    const { container } = render(<EditBlock data={{ toolName: 'patch_file', input: { file_path: '/tmp/ws/src/programs/conveyor.st', search_text: 'a', replacement: 'b' }, status: 'success', result: { ok: true, content: RESULT } }} />)
    const t = container.textContent || ''
    expect(t).toContain('conveyor.st'); expect(t).toContain('presence_sensor')
  })
})
