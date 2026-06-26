import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseIec2cErrors, runCompileChain, makeCompileScriptForTest } from '../src/compiler.js'
import { adviceForIec2cError } from '../src/tools/iec2cErrorParser.js'
import type { Iec2cError } from '../src/types.js'

describe('parseIec2cErrors', () => {
  it('parses matiec error format (alternate colon form)', () => {
    const stderr = 'program.st:5:10-5:20: error: Undefined symbol FOO\nprogram.st:7:1-7:5: warning: Unused variable BAR'
    const result = parseIec2cErrors(stderr)
    expect(result).toEqual<Iec2cError[]>([
      { line: 5, col: 10, message: 'Undefined symbol FOO', severity: 'error', sourceLine: '' },
      { line: 7, col: 1, message: 'Unused variable BAR', severity: 'warning', sourceLine: '' },
    ])
  })

  it('attaches the offending source line when stCode is provided', () => {
    const stCode = [
      'PROGRAM main',
      '  VAR',
      '    counter AT %QW0 : INT := 0;',
      '  END_VAR',
      'END_PROGRAM',
    ].join('\n')
    const stderr = 'program.st:3:5-3:30: error: invalid located variable declaration.'
    const result = parseIec2cErrors(stderr, stCode)
    expect(result[0].line).toBe(3)
    expect(result[0].sourceLine).toBe('    counter AT %QW0 : INT := 0;')
  })

  it('returns empty sourceLine when the line number is out of range', () => {
    const result = parseIec2cErrors('program.st:99:1-99:5: error: boom', 'one line only')
    expect(result[0].sourceLine).toBe('')
  })

  it('parses real matiec error format (dash + dotdot)', () => {
    const stderr = [
      'program.st:12-5..12-22: error: invalid located variable declaration.',
      ' 12 |     counter : INT := 0;',
      '    |     ^~~~~~~~~~~~~~~~~~',
      'program.st:20-5..20-11: error: invalid variable before \':=\' in ST assignment statement.',
    ].join('\n')
    const result = parseIec2cErrors(stderr)
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ line: 12, col: 5, message: 'invalid located variable declaration.', severity: 'error', sourceLine: '' })
    expect(result[1].line).toBe(20)
    expect(result[1].col).toBe(5)
  })

  it('returns empty array when no errors', () => {
    expect(parseIec2cErrors('')).toEqual([])
    expect(parseIec2cErrors('some irrelevant log output')).toEqual([])
  })

  it('attaches semicolon advice when a block terminator triggers "; missing"', () => {
    const stCode = ['IF x THEN', '  y := 1;', 'END_IF', 'z := 2;'].join('\n')
    const stderr = "program.st:3-1..3-6: error: ';' missing at the end of statement in ST statement."
    const result = parseIec2cErrors(stderr, stCode)
    expect(result[0].sourceLine).toBe('END_IF')
    expect(result[0].advice).toMatch(/END_IF/)
    expect(result[0].advice).toMatch(/semicolon|;/)
  })

  it('attaches name-collision advice for "invalid variable(s) declaration"', () => {
    const stderr = 'program.st:9-5..9-20: error: invalid variable(s) declaration.'
    const result = parseIec2cErrors(stderr)
    expect(result[0].advice).toMatch(/renam|collide|VAR block/i)
  })

  it('leaves advice undefined for unrecognized messages', () => {
    const result = parseIec2cErrors('program.st:1-1..1-2: error: totally novel matiec message')
    expect(result[0].advice).toBeUndefined()
  })
})

describe('adviceForIec2cError', () => {
  it('gives generic semicolon advice when the line is not a block terminator', () => {
    const advice = adviceForIec2cError("';' missing at the end of statement in ST statement.", 'y := 1')
    expect(advice).toMatch(/;/)
  })

  it('maps type mismatch to an explicit-conversion hint', () => {
    expect(adviceForIec2cError('type mismatch in expression', '')).toMatch(/INT_TO_REAL|conversion/i)
  })

  it('returns undefined for unknown messages', () => {
    expect(adviceForIec2cError('some unknown thing', '')).toBeUndefined()
  })
})

describe('makeCompileScript — recorder plugin config injection', () => {
  it('injects conf/recorder.json into the upload ZIP (keeps the always-on recorder enabled across uploads)', () => {
    // webserver/plcapp_management.py::update_plugin_configurations() scans
    // core/generated/conf/*.json, matches basename-without-ext to plugin.name,
    // and disables every enabled native plugin whose config file is absent.
    // Without conf/recorder.json in the ZIP each upload silently turns the
    // recorder off.  The zip command in the compile script must include this entry.
    const script = makeCompileScriptForTest()
    // The zip command line must reference conf/recorder.json (as a path to create
    // inside the ZIP under the conf/ prefix)
    expect(script).toContain('conf/recorder.json')
    // The zip packaging command must include conf/ so the directory (and
    // recorder.json inside it) is actually bundled — creation alone is not enough.
    expect(script).toMatch(/zip -r[^]*\bconf\//)
  })
})

describe('runCompileChain', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns success result when docker exec exits 0', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: '/tmp/w1d3_program.zip',
      stderr: '  [OK] Generated: Config0.c ...\n  [OK] Created: /tmp/w1d3_program.zip',
      exitCode: 0,
    })
    const result = await runCompileChain(
      'PROGRAM foo END_PROGRAM',
      'openplc-plc-dev',
      execMock,
    )
    expect(result.success).toBe(true)
    expect(result.zipPath).toBe('/tmp/w1d3_program.zip')
    expect(result.failedStage).toBeNull()
    expect(result.iec2c.warnings).toEqual([])
  })

  it('surfaces matiec warnings on a successful compile', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: '/tmp/x.zip',
      stderr: 'program.st:4-3..4-9: warning: unused variable TMP',
      exitCode: 0,
    })
    const result = await runCompileChain('PROGRAM p END_PROGRAM', 'c', execMock)
    expect(result.success).toBe(true)
    expect(result.iec2c.errors).toEqual([])
    expect(result.iec2c.warnings).toHaveLength(1)
    expect(result.iec2c.warnings[0].severity).toBe('warning')
    expect(result.iec2c.warnings[0].message).toContain('unused variable')
  })

  it('returns iec2c failure when docker exec exits non-zero with matiec error', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'program.st:3:1-3:5: error: Syntax error',
      exitCode: 1,
    })
    const result = await runCompileChain('bad st code', 'openplc-plc-dev', execMock)
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('iec2c')
    expect(result.iec2c.errors).toHaveLength(1)
    expect(result.iec2c.errors[0].message).toBe('Syntax error')
    expect(result.errorSummary).toContain('iec2c')
  })

  it('surfaces raw stderr when matiec bails out with no line-level diagnostics', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'Parsing failed because of too many consecutive syntax errors. Bailing out!',
      exitCode: 1,
    })
    const result = await runCompileChain('CONFIGRATION typo', 'c', execMock)
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('iec2c')
    expect(result.iec2c.errors).toEqual([])
    expect(result.errorSummary).toMatch(/bailed out/i)
    expect(result.errorSummary).toContain('Bailing out')
  })

  it('returns xml2st_debug failure when exit code is 2', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'xml2st_debug_failed',
      exitCode: 2,
    })
    const result = await runCompileChain('ok code', 'openplc-plc-dev', execMock)
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('xml2st_debug')
    expect(result.xml2st.debugSuccess).toBe(false)
  })

  it('returns xml2st_gluevars failure when exit code is 3', async () => {
    const execMock = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'xml2st_gluevars_failed',
      exitCode: 3,
    })
    const result = await runCompileChain('ok code', 'openplc-plc-dev', execMock)
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('xml2st_gluevars')
    expect(result.xml2st.glueVarsSuccess).toBe(false)
  })
})
