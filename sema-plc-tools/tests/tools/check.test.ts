import { describe, it, expect, vi } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleCheck, makeCheckPlan } from '../../src/tools/check.js'
import type { PlcConfig } from '../../src/config.js'

const cfg: PlcConfig = {
  url: 'https://localhost:8443', container: 'openplc-plc-dev',
  user: 'admin', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: '/tmp/s.json',
  checkStdlibDir: '/opt/iec61131-stdlib',
}

describe('makeCheckPlan', () => {
  // 并发的两次 check(Save All / 快速切文件)以前都 cp 到 /tmp/plc_check_input.st:
  // A 的源码被 B 覆盖,plc --check 跑的是 B,诊断却挂到 A 上。
  it('gives each run its own container path so concurrent checks cannot clobber each other', () => {
    const dirs = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'plc-check-')))
    try {
      const [a, b] = dirs.map(d => makeCheckPlan(d, cfg))
      expect(a.remoteSt).not.toBe(b.remoteSt)
      expect(a.script).toContain(a.remoteSt)
      expect(b.script).toContain(b.remoteSt)
      // 脚本里不能再残留写死的老路径
      expect(a.script).not.toContain('plc_check_input')
    } finally {
      dirs.forEach(d => fs.rmSync(d, { recursive: true, force: true }))
    }
  })

  it('still filters the panic-prone stdlib files', () => {
    const { script } = makeCheckPlan('/tmp/plc-check-Ab3xY9', cfg)
    expect(script).toContain('/opt/iec61131-stdlib/*.st')
    expect(script).toMatch(/grep -Ev "[^"]*bit_conversion[^"]*"/)
    expect(script).toContain("plc --check '/tmp/plc-check-Ab3xY9.st'")
  })
})

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
