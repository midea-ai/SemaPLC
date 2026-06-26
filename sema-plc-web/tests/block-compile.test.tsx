// tests/block-compile.test.tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CompileBlock } from '../src/components/left/blocks/tools/CompileBlock'
afterEach(cleanup)

const OK = JSON.stringify({ success: true, failedStage: null, compile: { success: true, iec2c: { success: true, errors: [], warnings: [], generatedFiles: ['Config0.c'] }, variableMap: [{ index: 0, name: 'presence_sensor', type: 'BOOL', location: '%IX0.0' }] } })
const FAIL = JSON.stringify({ success: false, failedStage: 'compile', compile: { success: false, failedStage: 'iec2c', iec2c: { success: false, errors: [{ line: 3, col: 5, severity: 'error', message: 'Bit size of data type is incompatible with bit size of location.', sourceLine: '    level AT %IW0 : REAL;', advice: 'Match type width to AT location.' }], warnings: [] }, variableMap: [], errorSummary: 'iec2c error at line 3: Bit size ...' } })

describe('CompileBlock', () => {
  it('success: shows ✓ and variableMap', () => {
    const { container } = render(<CompileBlock data={{ toolName: 'mcp__plc-tools__plc_buildAndRun', input: { stPath: 'a.st' }, status: 'success', result: { ok: true, content: OK } }} />)
    expect(container.textContent).toContain('presence_sensor')
  })
  it('failure: shows line, message, sourceLine and advice', () => {
    const { container } = render(<CompileBlock data={{ toolName: 'mcp__plc-tools__plc_buildAndRun', input: { stPath: 'a.st' }, status: 'error', result: { ok: false, content: FAIL } }} />)
    const t = container.textContent || ''
    expect(t).toContain('3:5')
    expect(t).toContain('Bit size')
    expect(t).toContain('AT %IW0')        // sourceLine
    expect(t).toContain('Match type width') // advice
  })
})
