import { describe, it, expect, vi, afterEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { handleCompile, normalizeCsv } from '../../src/tools/compile.js'
import type { PlcConfig } from '../../src/config.js'

const TMP_STATE = path.join(os.tmpdir(), `compile-test-state-${Date.now()}.json`)
const cfg: PlcConfig = {
  url: 'https://localhost:8443', container: 'test-container',
  user: 'admin', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: TMP_STATE,
}

afterEach(() => vi.restoreAllMocks())

describe('handleCompile', () => {
  it('returns success result and writes variableMap to state', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: '/tmp/program.zip',
      stderr: '',
      exitCode: 0,
    })
    // Provide a minimal VARIABLES.csv mock (docker cp reads from container)
    const mockReadCsv = vi.fn().mockResolvedValue('scan_count,INT,%QW0,0\nflag,BOOL,%QX0.0,1')

    const result = await handleCompile(
      { stCode: 'PROGRAM foo END_PROGRAM' },
      cfg,
      mockExec,
      mockReadCsv,
    )

    expect(result.success).toBe(true)
    expect(result.zipPath).toBe('/tmp/program.zip')
    expect(result.variableMap).toEqual([
      { index: 0, name: 'scan_count', type: 'INT', location: '%QW0' },
      { index: 1, name: 'flag', type: 'BOOL', location: '%QX0.0' },
    ])
    expect(result.failedStage).toBeNull()
  })

  it('injects a modbus_slave conf into the ZIP when modbusPort is set', async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: '/tmp/program.zip', stderr: '', exitCode: 0 })
    const mockReadCsv = vi.fn().mockResolvedValue('led,BOOL,%QX0.0,0')
    const inject = vi.fn().mockResolvedValue(undefined)

    await handleCompile(
      { stCode: 'PROGRAM p VAR led AT %QX0.0 : BOOL; END_VAR led := TRUE; END_PROGRAM' },
      { ...cfg, modbusPort: 502 },
      mockExec, mockReadCsv, inject,
    )

    expect(inject).toHaveBeenCalledTimes(1)
    const [container, zipPath, json] = inject.mock.calls[0]
    expect(container).toBe('test-container')
    expect(zipPath).toBe('/tmp/program.zip')
    const conf = JSON.parse(json)
    expect(conf.network_configuration.port).toBe(502)
    expect(conf.buffer_mapping.coils.qx_bits).toBe(1)  // sized from the %QX0.0 declaration
  })

  it('does NOT inject a modbus conf when modbusPort is unset (default off)', async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: '/tmp/program.zip', stderr: '', exitCode: 0 })
    const inject = vi.fn().mockResolvedValue(undefined)
    await handleCompile({ stCode: 'PROGRAM p END_PROGRAM' }, cfg, mockExec, vi.fn().mockResolvedValue(''), inject)
    expect(inject).not.toHaveBeenCalled()
  })

  it('returns failure result without writing state when iec2c fails', async () => {
    const mockExec = vi.fn().mockResolvedValue({
      stdout: '',
      stderr: 'program.st:3:1-3:5: error: Syntax error near FOO',
      exitCode: 1,
    })
    const result = await handleCompile(
      { stCode: 'bad code' },
      cfg,
      mockExec,
      vi.fn(),
    )
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('iec2c')
    expect(result.iec2c.errors[0].message).toBe('Syntax error near FOO')
    expect(result.variableMap).toEqual([])
  })

  it('HARD-FAILS at the validate stage (before matiec) when a declared %Q output is never assigned (P0b dead output)', async () => {
    // conveyor_run is declared as an output but the body never assigns it → dead
    // output. The gate fires before runCompileChain, so mockExec is never called.
    const mockExec = vi.fn()
    const ST = 'PROGRAM p VAR conveyor_run AT %QX0.0 : BOOL; lamp AT %QX0.1 : BOOL; END_VAR lamp := TRUE; END_PROGRAM'
    const result = await handleCompile({ stCode: ST }, cfg, mockExec, vi.fn())
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('validate')
    expect(result.errorSummary).toMatch(/死输出|conveyor_run/)
    expect(result.iec2c.errors[0].advice).toMatch(/赋值|死输出|驱动/)
    expect(mockExec).not.toHaveBeenCalled()   // short-circuited before matiec
  })

  it('passes the validate gate when every declared %Q output is assigned somewhere', async () => {
    const mockExec = vi.fn().mockResolvedValue({ stdout: '/tmp/program.zip', stderr: '', exitCode: 0 })
    const ST = 'PROGRAM p VAR conveyor_run AT %QX0.0 : BOOL; END_VAR conveyor_run := TRUE; END_PROGRAM'
    const result = await handleCompile({ stCode: ST }, cfg, mockExec, vi.fn().mockResolvedValue(''))
    expect(result.failedStage).not.toBe('validate')
    expect(mockExec).toHaveBeenCalled()   // reached matiec
  })
})

describe('normalizeCsv', () => {
  it('strips CONFIG.RES.INST prefix for program-level variables', () => {
    const raw = [
      '// Programs',
      '0;CONFIG0.RES0.INST0;TEST;',
      '',
      '// Variables',
      '0;FB;CONFIG0.RES0.INST0;CONFIG0.RES0.INST0;TEST;;0;',
      '1;OUT;CONFIG0.RES0.INST0.HB_OUT;CONFIG0.RES0.INST0.HB_OUT;BOOL;BOOL;0;',
      '2;VAR;CONFIG0.RES0.INST0.TOGGLE;CONFIG0.RES0.INST0.TOGGLE;BOOL;BOOL;0;',
    ].join('\n')
    expect(normalizeCsv(raw)).toBe([
      'hb_out,BOOL,,0',
      'toggle,BOOL,,1',
    ].join('\n'))
  })

  it('keeps FB instance prefix to avoid name collision across multiple FBs', () => {
    // 3 FBs each with .Q output: without prefix, all become "q" and collide.
    // With prefix: timer1.q / timer2.q / rtrig.q — uniquely addressable.
    const raw = [
      '0;FB;CONFIG0.RES0.INST0;CONFIG0.RES0.INST0;TEST;;0;',
      '1;OUT;CONFIG0.RES0.INST0.HB_OUT;CONFIG0.RES0.INST0.HB_OUT;BOOL;BOOL;0;',
      '2;FB;CONFIG0.RES0.INST0.TIMER1;CONFIG0.RES0.INST0.TIMER1;TON;;0;',
      '3;VAR;CONFIG0.RES0.INST0.TIMER1.Q;CONFIG0.RES0.INST0.TIMER1.Q;BOOL;BOOL;0;',
      '4;FB;CONFIG0.RES0.INST0.TIMER2;CONFIG0.RES0.INST0.TIMER2;TON;;0;',
      '5;VAR;CONFIG0.RES0.INST0.TIMER2.Q;CONFIG0.RES0.INST0.TIMER2.Q;BOOL;BOOL;0;',
      '6;FB;CONFIG0.RES0.INST0.RTRIG;CONFIG0.RES0.INST0.RTRIG;R_TRIG;;0;',
      '7;VAR;CONFIG0.RES0.INST0.RTRIG.Q;CONFIG0.RES0.INST0.RTRIG.Q;BOOL;BOOL;0;',
    ].join('\n')
    const out = normalizeCsv(raw).split('\n')
    expect(out).toEqual([
      'hb_out,BOOL,,0',
      'timer1.q,BOOL,,1',
      'timer2.q,BOOL,,2',
      'rtrig.q,BOOL,,3',
    ])
    // Explicit no-collision check
    const names = out.map(l => l.split(',')[0])
    expect(new Set(names).size).toBe(names.length)
  })

  it('skips FB rows and structural rows shorter than 4 segments', () => {
    const raw = [
      '// Programs',
      '0;CONFIG0.RES0.INST0;TEST;',  // structural — kind missing, < 5 cols
      '0;FB;CONFIG0.RES0.INST0;CONFIG0.RES0.INST0;TEST;;0;',  // FB instance row
      '1;OUT;CONFIG0.RES0.INST0.LED;CONFIG0.RES0.INST0.LED;BOOL;BOOL;0;',
    ].join('\n')
    expect(normalizeCsv(raw)).toBe('led,BOOL,,0')
  })

  it('returns empty string on empty input', () => {
    expect(normalizeCsv('')).toBe('')
  })

  it('skips blank lines and comments', () => {
    const raw = [
      '',
      '// header',
      '   ',
      '0;FB;CONFIG0.RES0.INST0;CONFIG0.RES0.INST0;TEST;;0;',
      '1;OUT;CONFIG0.RES0.INST0.LED;CONFIG0.RES0.INST0.LED;BOOL;BOOL;0;',
      '',
      '// footer',
    ].join('\n')
    expect(normalizeCsv(raw)).toBe('led,BOOL,,0')
  })

  it('handles nested FB output (>5 segments) by joining all post-prefix segments', () => {
    // Hypothetical: if someone nests FBs deeper (rare but valid IEC), keep full sub-path.
    const raw = [
      '0;FB;CONFIG0.RES0.INST0;CONFIG0.RES0.INST0;TEST;;0;',
      '1;VAR;CONFIG0.RES0.INST0.OUTER.INNER.SIGNAL;CONFIG0.RES0.INST0.OUTER.INNER.SIGNAL;BOOL;BOOL;0;',
    ].join('\n')
    expect(normalizeCsv(raw)).toBe('outer.inner.signal,BOOL,,0')
  })
})
