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
      file: '/tmp/plc_check_input.st',
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
    expect(errs[0].file).toBe('/tmp/x.st')
  })

  // 真实样本(容器 openplc-plc-dev,rusty v0.5.0):一次 check 吐 29 条 error,只有第 1 条
  // 是用户代码的,其余 28 条是 stdlib 内部的 E048 级联(SKIP_STDLIB 排掉 bit_conversion.st
  // 但别的 stdlib 引用它)。行号缩进随行号位数变化,这里保留原样。
  it('keeps the file path so stdlib cascades can be told apart from user code', () => {
    const raw = [
      'error[E052]: Unknown type: BOGUS_TYPE',
      '  ┌─ /tmp/plc-check-Ab3xY9.st:4:7',
      '  │',
      '4 │   y : BOGUS_TYPE;',
      '  │       ^^^^^^^^^^ Unknown type: BOGUS_TYPE',
      '',
      "warning[E067]: Implicit downcast from 'UDINT' to 'DINT'.",
      '    ┌─ /opt/iec61131-stdlib/arithmetic_functions.st:221:48',
      '',
      'error[E048]: Could not resolve reference to BYTE_TO_BOOL',
      '   ┌─ /opt/iec61131-stdlib/to_bit.st:20:22',
      '   │',
      '20 │     BYTE_TO_BOOL := in;',
      '',
      'error[E048]: Could not resolve reference to DWORD_TO_BYTE',
      '    ┌─ /opt/iec61131-stdlib/to_bit.st:100:23',
    ].join('\n')
    const errs = parseRustyErrors(raw)
    expect(errs).toHaveLength(3)   // warning[E067] 不是 error,不该被收进来

    const stdlibDir = '/opt/iec61131-stdlib'
    const mine = errs.filter(e => e.file && !e.file.startsWith(stdlibDir))
    expect(mine).toHaveLength(1)
    expect(mine[0]).toEqual({
      code: 'E052', message: 'Unknown type: BOGUS_TYPE',
      line: 4, col: 7, file: '/tmp/plc-check-Ab3xY9.st',
    })
    expect(errs[1].file).toBe(`${stdlibDir}/to_bit.st`)
    expect(errs[1].line).toBe(20)
    expect(errs[2].line).toBe(100)
  })

  it('returns [] when there are no error lines', () => {
    expect(parseRustyErrors('Implicit downcast from LREAL to REAL.')).toEqual([])
  })

  it('yields null line/col when no location line follows the error', () => {
    const errs = parseRustyErrors('error[E099]: standalone error with no codespan location')
    expect(errs).toHaveLength(1)
    expect(errs[0]).toEqual({ code: 'E099', message: 'standalone error with no codespan location', line: null, col: null })
    expect(errs[0].file).toBeUndefined()
  })
})
