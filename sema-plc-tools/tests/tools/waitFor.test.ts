import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MCP_SAFE_MAX_MS } from '../../src/mcpBudget.js'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleWaitFor } from '../../src/tools/waitFor.js'
import type { PlcConfig } from '../../src/config.js'
import type { PlcState, VariableEntry, VariableValue } from '../../src/types.js'

const TMP_STATE = path.join(os.tmpdir(), `wait-test-${Date.now()}.json`)
const cfg: PlcConfig = { url: 'https://localhost:8443', container: 'c', user: 'admin', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: TMP_STATE }

const varMap = [
  { index: 0, name: 'counter', type: 'INT', location: '%QW0' },
  { index: 1, name: 'flag', type: 'BOOL', location: '%QX0.0' },
]

beforeEach(() => {
  const state: PlcState = { lastCompile: { timestamp: '', stCode: '', zipPath: '', variableMap: varMap } }
  fs.mkdirSync(path.dirname(TMP_STATE), { recursive: true })
  fs.writeFileSync(TMP_STATE, JSON.stringify(state))
})
afterEach(() => { try { fs.unlinkSync(TMP_STATE) } catch {}; vi.restoreAllMocks() })

// Snapshot mock whose counter increments each poll.
function makeSnap(start = 0) {
  let c = start; let tick = 50
  return vi.fn(async (_b: string, _t: string, vars: VariableEntry[]) => {
    const values: Record<string, VariableValue> = {}
    for (const v of vars) {
      values[v.name] = v.name === 'counter'
        ? { value: c, type: 'INT', index: v.index, location: v.location }
        : { value: c >= 3, type: 'BOOL', index: v.index, location: v.location }
    }
    tick += 1; c += 1
    return { tick, values }
  })
}

describe('handleWaitFor', () => {
  it('returns success when the condition becomes true', async () => {
    const snap = makeSnap(0)
    const r = await handleWaitFor({ varName: 'counter', op: '>=', value: 3, intervalMs: 1, timeoutMs: 5000 }, cfg, snap)
    expect(r.success).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.finalValue).toBe(3)
    expect(r.polls).toBe(4) // 0,1,2,3
    expect(typeof r.tick).toBe('number')
  })

  it('matches a boolean equality on the first poll', async () => {
    const snap = makeSnap(5) // counter starts >=3 so flag is true immediately
    const r = await handleWaitFor({ varName: 'flag', op: '==', value: true, intervalMs: 1 }, cfg, snap)
    expect(r.success).toBe(true)
    expect(r.polls).toBe(1)
  })

  it('times out when the condition never holds', async () => {
    const snap = makeSnap(0)
    const r = await handleWaitFor({ varName: 'counter', op: '>', value: 1000, intervalMs: 5, timeoutMs: 30 }, cfg, snap)
    expect(r.success).toBe(false)
    expect(r.timedOut).toBe(true)
    expect(r.errorMessage).toBeNull()
    expect(r.polls).toBeGreaterThan(0)
  })

  it('errors with a suggestion for an unresolved variable', async () => {
    const r = await handleWaitFor({ varName: 'countr', op: '==', value: 1 }, cfg, makeSnap())
    expect(r.success).toBe(false)
    expect(r.errorMessage).toContain('not found')
    expect(r.nameSuggestion).toBe('counter')
  })

  it('errors when there is no compile state', async () => {
    fs.writeFileSync(TMP_STATE, JSON.stringify({ lastCompile: null }))
    const r = await handleWaitFor({ varName: 'counter', op: '==', value: 1 }, cfg, makeSnap())
    expect(r.success).toBe(false)
    expect(r.errorMessage).toContain('No variable map')
  })

  it('surfaces a global error when the read throws', async () => {
    const snap = vi.fn(async () => { throw new Error('socket down') })
    const r = await handleWaitFor({ varName: 'counter', op: '==', value: 1, intervalMs: 1 }, cfg, snap)
    expect(r.success).toBe(false)
    expect(r.errorMessage).toContain('socket down')
  })
})

describe('handleWaitFor — MCP budget clamp', () => {
  it('clamps a 120s timeoutMs so the loop cannot run to 120s', async () => {
    const snap = makeSnap(0)
    const t0 = Date.now()
    // intervalMs == MCP_SAFE_MAX_MS: after the clamp timeoutMs==MCP_SAFE_MAX_MS, so the
    // loop's `elapsed + interval >= timeoutMs` guard breaks after ONE poll (instant).
    // Un-clamped (120000) it would instead sleep 50s before the next poll.
    const r = await handleWaitFor(
      { varName: 'counter', op: '>', value: 999999, intervalMs: MCP_SAFE_MAX_MS, timeoutMs: 120_000 },
      cfg, snap,
    )
    expect(r.timedOut).toBe(true)
    expect(r.polls).toBe(1)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})
