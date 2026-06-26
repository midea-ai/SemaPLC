import { describe, it, expect } from 'vitest'
import { stripAnsi, parseRustyErrors } from '../../src/tools/rustyErrorParser.js'

describe('stripAnsi', () => {
  it('removes SGR color escape codes', () => {
    const s = '\x1b[0m\x1b[1m\x1b[38;5;9merror[E006]\x1b[0m: boom'
    expect(stripAnsi(s)).toBe('error[E006]: boom')
  })
})

describe('parseRustyErrors', () => {
  it('parses code + message + line/col from codespan output', () => {
    const raw = [
      'error[E006]: Missing expected Token [KeywordSemicolon, KeywordColon]',
      '   ┌─ /tmp/plc_check_input.st:10:3',
      '   │',
      '10 │   END_IF;',
      '   │   ^^^^^^ Missing expected Token',
      '',
      "error[E007]: Unexpected token: expected KeywordSemicolon but found 'END_IF'",
      '   ┌─ /tmp/plc_check_input.st:10:3',
    ].join('\n')
    const errs = parseRustyErrors(raw)
    expect(errs).toHaveLength(2)
    expect(errs[0]).toEqual({
      code: 'E006',
      message: 'Missing expected Token [KeywordSemicolon, KeywordColon]',
      line: 10,
      col: 3,
    })
    expect(errs[1].code).toBe('E007')
    expect(errs[1].line).toBe(10)
    expect(errs[1].col).toBe(3)
  })

  it('strips ANSI before parsing', () => {
    const raw = '\x1b[38;5;9merror[E052]\x1b[0m: Unknown type: VARIANT\n   ┌─ /tmp/x.st:4:11'
    const errs = parseRustyErrors(raw)
    expect(errs[0].code).toBe('E052')
    expect(errs[0].line).toBe(4)
    expect(errs[0].col).toBe(11)
  })

  it('returns [] when there are no error lines', () => {
    expect(parseRustyErrors('Implicit downcast from LREAL to REAL.')).toEqual([])
  })

  it('yields null line/col when no location line follows the error', () => {
    const errs = parseRustyErrors('error[E099]: standalone error with no codespan location')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toEqual({ code: 'E099', message: 'standalone error with no codespan location', line: null, col: null })
  })
})
