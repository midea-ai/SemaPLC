import { describe, it, expect, vi } from 'vitest'
import { handleCheck } from '../../src/tools/check.js'
import type { PlcConfig } from '../../src/config.js'

const cfg: PlcConfig = {
  url: 'https://localhost:8443', container: 'openplc-plc-dev',
  user: 'admin', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: '/tmp/s.json',
  checkStdlibDir: '/opt/iec61131-stdlib',
}

describe('handleCheck', () => {
  it('ok=true on exit 0', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '', exitCode: 0 })
    const r = await handleCheck({ stCode: 'FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK' }, cfg, exec)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
    expect(r.errorMessage).toBeNull()
  })

  it('ok=false with parsed errors on exit 1', async () => {
    const stdout = 'error[E006]: Missing expected Token\n   ┌─ /tmp/plc_check_input.st:10:3'
    const exec = vi.fn().mockResolvedValue({ stdout, exitCode: 1 })
    const r = await handleCheck({ stCode: 'bad' }, cfg, exec)
    expect(r.ok).toBe(false)
    expect(r.errors[0].code).toBe('E006')
    expect(r.errors[0].line).toBe(10)
    expect(r.errorMessage).toBeNull()
  })

  it('nonzero exit with no diagnostics → infra errorMessage', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: 'bash: plc: command not found', exitCode: 127 })
    const r = await handleCheck({ stCode: 'x' }, cfg, exec)
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual([])
    expect(r.errorMessage).toMatch(/no parseable diagnostics/i)
  })

  it('rejects empty stCode without calling exec', async () => {
    const exec = vi.fn()
    const r = await handleCheck({ stCode: '   ' }, cfg, exec)
    expect(r.ok).toBe(false)
    expect(exec).not.toHaveBeenCalled()
    expect(r.errorMessage).toMatch(/stCode is required/)
  })

  it('surfaces a thrown exec as infra error', async () => {
    const exec = vi.fn().mockRejectedValue(new Error('docker daemon down'))
    const r = await handleCheck({ stCode: 'x' }, cfg, exec)
    expect(r.ok).toBe(false)
    expect(r.errorMessage).toContain('docker daemon down')
  })
})
