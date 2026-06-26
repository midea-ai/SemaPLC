import { describe, it, expect, vi } from 'vitest'
import { handleVerifyBehavior } from '../../src/tools/verifyBehavior.js'
import type { PlcConfig } from '../../src/config.js'
import type { ForceVariablesResult, WaitForResult } from '../../src/types.js'

const cfg = { url: 'x', container: '', checkStdlibDir: '', user: '', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: '/tmp/x.json' } as unknown as PlcConfig

const okForce = (): ForceVariablesResult =>
  ({ success: true, forced: [{ name: 'sensor', index: 0, type: 'BOOL', value: true }], released: [], failed: [], errorMessage: null })
const failForce = (): ForceVariablesResult =>
  ({ success: false, forced: [], released: [], failed: [{ name: 'x', reason: 'INT at internal is not forceable' }], errorMessage: null })
const releaseResult = (names: string[]): ForceVariablesResult =>
  ({ success: true, forced: [], released: names, failed: [], errorMessage: null })
const matchWait = (): WaitForResult =>
  ({ success: true, timedOut: false, finalValue: true, tick: 1, elapsedMs: 43, polls: 3, errorMessage: null })
const timeoutWait = (): WaitForResult =>
  ({ success: false, timedOut: true, finalValue: false, tick: 1, elapsedMs: 5000, polls: 25, errorMessage: null })

describe('handleVerifyBehavior', () => {
  it('forces inputs → waits for downstream condition → matches → success + auto-release (default)', async () => {
    const force = vi.fn()
      .mockResolvedValueOnce(okForce())                // set
      .mockResolvedValueOnce(releaseResult(['sensor'])) // release (releaseAfter defaults true)
    const waitFor = vi.fn().mockResolvedValue(matchWait())
    const r = await handleVerifyBehavior(
      { set: { sensor: true }, expect: { varName: 'pusher1', op: '==', value: true } },
      cfg, { force, waitFor },
    )
    expect(r.success).toBe(true)
    expect(r.expect.matched).toBe(true)
    expect(r.forced).toEqual([{ name: 'sensor', index: 0, type: 'BOOL', value: true }])
    // force called twice: set, then release; waitFor got the expect condition
    // (with an explicit budget-clamped timeoutMs so settle+wait stays under the MCP limit)
    expect(force).toHaveBeenNthCalledWith(1, { set: { sensor: true } }, cfg)
    expect(force).toHaveBeenNthCalledWith(2, { release: ['sensor'] }, cfg)
    expect(waitFor).toHaveBeenCalledWith({ varName: 'pusher1', op: '==', value: true, timeoutMs: 5000 }, cfg)
    expect(r.released).toEqual(['sensor'])
  })

  it('downstream condition times out → success:false, timedOut, verdict explains', async () => {
    const force = vi.fn().mockResolvedValueOnce(okForce()).mockResolvedValueOnce(releaseResult(['sensor']))
    const waitFor = vi.fn().mockResolvedValue(timeoutWait())
    const r = await handleVerifyBehavior(
      { set: { sensor: true }, expect: { varName: 'pusher1', op: '==', value: true } }, cfg, { force, waitFor })
    expect(r.success).toBe(false)
    expect(r.expect.timedOut).toBe(true)
    expect(r.verdict).toMatch(/未响应|未成立|检查/)
  })

  it('non-forceable input → fail BEFORE waiting (no waitFor round-trip)', async () => {
    const force = vi.fn().mockResolvedValue(failForce())
    const waitFor = vi.fn()
    const r = await handleVerifyBehavior(
      { set: { x: 1 }, expect: { varName: 'y', op: '==', value: 1 } }, cfg, { force, waitFor })
    expect(r.success).toBe(false)
    expect(r.forceFailed.length).toBeGreaterThan(0)
    expect(waitFor).not.toHaveBeenCalled()
  })

  it('releaseAfter:false leaves the force held (no release call)', async () => {
    const force = vi.fn().mockResolvedValueOnce(okForce())
    const waitFor = vi.fn().mockResolvedValue(matchWait())
    await handleVerifyBehavior(
      { set: { sensor: true }, expect: { varName: 'p', op: '==', value: true }, releaseAfter: false }, cfg, { force, waitFor })
    expect(force).toHaveBeenCalledTimes(1)   // only set, no release
  })
})

describe('multi-expect (array)', () => {
  it('all conditions match → success', async () => {
    const force = vi.fn()
      .mockResolvedValueOnce(okForce())
      .mockResolvedValueOnce(releaseResult(['sensor']))
    const waitFor = vi.fn().mockResolvedValue(matchWait())
    const r = await handleVerifyBehavior(
      {
        set: { sensor: true },
        expect: [
          { varName: 'motor', op: '==', value: true },
          { varName: 'run_led', op: '==', value: true },
        ],
      },
      cfg, { force, waitFor },
    )
    expect(r.success).toBe(true)
    expect(Array.isArray(r.expect)).toBe(true)
    const expects = r.expect as any[]
    expect(expects).toHaveLength(2)
    expect(expects[0].matched).toBe(true)
    expect(expects[1].matched).toBe(true)
    expect(waitFor).toHaveBeenCalledTimes(2)
  })

  it('one condition fails → success:false, all results reported', async () => {
    const force = vi.fn()
      .mockResolvedValueOnce(okForce())
      .mockResolvedValueOnce(releaseResult(['sensor']))
    const waitFor = vi.fn()
      .mockResolvedValueOnce(matchWait())
      .mockResolvedValueOnce(timeoutWait())
    const r = await handleVerifyBehavior(
      {
        set: { sensor: true },
        expect: [
          { varName: 'motor', op: '==', value: true },
          { varName: 'run_led', op: '==', value: true },
        ],
      },
      cfg, { force, waitFor },
    )
    expect(r.success).toBe(false)
    const expects = r.expect as any[]
    expect(expects[0].matched).toBe(true)
    expect(expects[1].matched).toBe(false)
  })

  it('single expect (object) still works — backward compat', async () => {
    const force = vi.fn()
      .mockResolvedValueOnce(okForce())
      .mockResolvedValueOnce(releaseResult(['sensor']))
    const waitFor = vi.fn().mockResolvedValue(matchWait())
    const r = await handleVerifyBehavior(
      { set: { sensor: true }, expect: { varName: 'pusher1', op: '==', value: true } },
      cfg, { force, waitFor },
    )
    expect(r.success).toBe(true)
    // Single expect → expect result is an object, not an array
    expect(Array.isArray(r.expect)).toBe(false)
  })
})
