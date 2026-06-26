import { describe, it, expect } from 'vitest'
import { extractUserProgram } from '../../server/routes/normalize.js'

describe('extractUserProgram', () => {
  it('returns content after {enable code generation} marker', () => {
    const raw = `FUNCTION foo : INT
  RETURN;
END_FUNCTION

{enable code generation}PROGRAM hb
  VAR x : BOOL; END_VAR
END_PROGRAM`
    expect(extractUserProgram(raw)).toBe('PROGRAM hb\n  VAR x : BOOL; END_VAR\nEND_PROGRAM')
  })

  it('falls back to whole input when marker missing', () => {
    expect(extractUserProgram('PROGRAM x END_PROGRAM')).toBe('PROGRAM x END_PROGRAM')
  })

  it('trims whitespace from result', () => {
    const raw = `{disable code generation}FUNCTION foo END_FUNCTION

{enable code generation}

PROGRAM hb END_PROGRAM
   `
    expect(extractUserProgram(raw)).toBe('PROGRAM hb END_PROGRAM')
  })

  it('returns empty string when only the marker is present', () => {
    expect(extractUserProgram('{enable code generation}')).toBe('')
  })
})
