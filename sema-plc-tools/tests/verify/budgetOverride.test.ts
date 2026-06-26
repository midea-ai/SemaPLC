import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleWaitFor } from '../../src/tools/waitFor.js'
import { handleVerifyBehavior } from '../../src/tools/verifyBehavior.js'
import type { PlcConfig } from '../../src/config.js'

function cfgWithMap(): PlcConfig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-bo-'))
  const stateFile = path.join(dir, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify({ lastCompile: {
    timestamp: 't', stCode: 'P', zipPath: '/z',
    variableMap: [{ index: 0, name: 'x', type: 'INT', location: '%QW0' }],
  } }))
  return { url: 'http://u', container: '', checkStdlibDir: '', user: '', password: process.env.PLC_TEST_PW ?? 'pw', stateFile } as PlcConfig
}
const neverMatch = async () => ({ tick: 1, values: { x: { value: 0, type: 'INT', index: 0, location: '%QW0' } } })

describe('budgetOverride', () => {
  it('waitFor: budgetOverrideMs lifts AND caps the budget (覆盖更大的 input.timeoutMs)', async () => {
    const t0 = Date.now()
    const r = await handleWaitFor({ varName: 'x', op: '==', value: 1, timeoutMs: 60_000, intervalMs: 100 }, cfgWithMap(), neverMatch, 400)
    expect(r.timedOut).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2_000)
  })
  it('waitFor: 不传 override 时 input.timeoutMs 仍被 50s clamp 语义处理(小值原样生效)', async () => {
    const t0 = Date.now()
    const r = await handleWaitFor({ varName: 'x', op: '==', value: 1, timeoutMs: 300, intervalMs: 50 }, cfgWithMap(), neverMatch)
    expect(r.timedOut).toBe(true)
    expect(Date.now() - t0).toBeLessThan(1_500)
  })
  it('verifyBehavior: deps.budgetMs caps settle+wait', async () => {
    const force = async () => ({ success: true, forced: [], released: [], failed: [], errorMessage: null })
    const waitFor = async (i: any) => ({ success: false, timedOut: true, finalValue: 0, tick: 1, elapsedMs: i.timeoutMs, polls: 1, errorMessage: null })
    const r = await handleVerifyBehavior(
      { set: { x: 1 }, expect: { varName: 'x', op: '==', value: 2, timeoutMs: 60_000 } },
      cfgWithMap(), { force: force as any, waitFor: waitFor as any, budgetMs: 3_000 })
    expect((r.expect as any).elapsedMs).toBeLessThanOrEqual(3_000)
  })
})
