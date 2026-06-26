import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleTrace } from '../../src/tools/trace.js'
import type { PlcConfig } from '../../src/config.js'
import type { PlcState, VariableEntry, VariableValue } from '../../src/types.js'

const TMP_STATE = path.join(os.tmpdir(), `trace-test-${Date.now()}.json`)
const cfg: PlcConfig = {
  url: 'https://localhost:8443',
  container: 'c',
  user: 'admin',
  password: process.env.PLC_TEST_PW ?? 'pw',
  stateFile: TMP_STATE,
}

const varMap = [
  { index: 0, name: 'counter', type: 'INT', location: '%QW0' },
  { index: 1, name: 'flag', type: 'BOOL', location: '%QX0.0' },
]

beforeEach(() => {
  const state: PlcState = {
    lastCompile: { timestamp: '', stCode: '', zipPath: '', variableMap: varMap },
  }
  fs.mkdirSync(path.dirname(TMP_STATE), { recursive: true })
  fs.writeFileSync(TMP_STATE, JSON.stringify(state))
})

afterEach(() => {
  try { fs.unlinkSync(TMP_STATE) } catch {}
  vi.restoreAllMocks()
})

// A snapshot mock whose counter increments each call, simulating scan progression.
function makeSnapshotMock() {
  let tick = 100
  let counter = 0
  return vi.fn(async (_b: string, _t: string, vars: VariableEntry[]) => {
    const values: Record<string, VariableValue> = {}
    for (const v of vars) {
      values[v.name] = v.name === 'counter'
        ? { value: counter, type: 'INT', index: v.index, location: v.location }
        : { value: counter % 2 === 0, type: 'BOOL', index: v.index, location: v.location }
    }
    tick += 5
    counter += 1
    return { tick, values }
  })
}

describe('handleTrace', () => {
  it('collects the requested number of samples with tick and elapsedMs', async () => {
    const snap = makeSnapshotMock()
    const result = await handleTrace({ samples: 4, intervalMs: 1 }, cfg, snap)
    expect(result.success).toBe(true)
    expect(result.samples).toHaveLength(4)
    expect(snap).toHaveBeenCalledTimes(4)
    // tick advances monotonically across samples
    const ticks = result.samples.map(s => s.tick as number)
    expect(ticks).toEqual([105, 110, 115, 120])
    // counter monotonically increases — the kind of temporal check this enables
    expect(result.samples.map(s => s.values[result.columns.indexOf('counter')])).toEqual([0, 1, 2, 3])
    expect(result.samples.every(s => typeof s.elapsedMs === 'number')).toBe(true)
  })

  it('returns columnar format: columns + meta once, samples carry bare value arrays', async () => {
    const snap = makeSnapshotMock()
    const result = await handleTrace({ varNames: ['counter', 'flag'], samples: 3, intervalMs: 1 }, cfg, snap)
    expect(result.success).toBe(true)
    // columns: order = requested order
    expect(result.columns).toEqual(['counter', 'flag'])
    // meta: declared once, per column, type/index/location
    expect(result.meta).toEqual({
      counter: { type: 'INT', index: 0, location: '%QW0' },
      flag: { type: 'BOOL', index: 1, location: '%QX0.0' },
    })
    // samples: values is a bare array aligned to columns (NOT a per-name object)
    expect(result.samples).toHaveLength(3)
    expect(Array.isArray(result.samples[0].values)).toBe(true)
    expect(result.samples[0].values).toEqual([0, true])   // counter=0, flag=(0%2==0)=true
    expect(result.samples[1].values).toEqual([1, false])
    expect(typeof result.samples[0].tick).toBe('number')
  })

  it('failed sample yields tick:null and empty values array', async () => {
    let n = 0
    const snap = vi.fn(async () => { n++; if (n === 2) throw new Error('read fail'); return { tick: 100 + n, values: { counter: { value: n, type: 'INT', index: 0, location: '%QW0' } } } })
    const result = await handleTrace({ varNames: ['counter'], samples: 3, intervalMs: 1 }, cfg, snap as any)
    expect(result.samples[1].tick).toBeNull()
    expect(result.samples[1].values).toEqual([])
  })

  it('derives sample count from durationMs / intervalMs', async () => {
    const snap = makeSnapshotMock()
    const result = await handleTrace({ durationMs: 10, intervalMs: 5 }, cfg, snap)
    // floor(10/5)+1 = 3
    expect(result.samples).toHaveLength(3)
  })

  it('clamps sample count to the 200 maximum', async () => {
    const snap = makeSnapshotMock()
    const result = await handleTrace({ samples: 5000, intervalMs: 1 }, cfg, snap)
    expect(result.samples).toHaveLength(200)
  })

  it('reports unresolved names with suggestions and still traces the resolved ones', async () => {
    const snap = makeSnapshotMock()
    // 'counter' resolves exactly; 'COUNTER' resolves case-insensitively; 'flagg' is a
    // genuine typo → unresolved with a suggestion.
    const result = await handleTrace({ varNames: ['counter', 'COUNTER', 'flagg'], samples: 2, intervalMs: 1 }, cfg, snap)
    expect(result.unresolvedNames).toEqual(['flagg'])
    expect(result.nameSuggestions?.['flagg']).toBe('flag')
    expect(result.samples).toHaveLength(2)
    expect(result.samples[0].values[result.columns.indexOf('counter')]).toBeDefined()
  })

  it('errors when there is no compile state', async () => {
    fs.writeFileSync(TMP_STATE, JSON.stringify({ lastCompile: null }))
    const result = await handleTrace({ samples: 2 }, cfg, makeSnapshotMock())
    expect(result.success).toBe(false)
    expect(result.errorMessage).toContain('No variable map')
  })

  it('returns success with null-tick samples when all samples throw (fail-soft)', async () => {
    const snap = vi.fn(async () => { throw new Error('socket boom') })
    const result = await handleTrace({ samples: 3, intervalMs: 1 }, cfg, snap)
    expect(result.success).toBe(true)
    expect(result.samples).toHaveLength(3)
    expect(result.samples.every(s => s.tick === null)).toBe(true)
    expect(result.note).toMatch(/读取均失败|fail/)
  })

  it('fail-soft: a throwing sample records null and sampling continues', async () => {
    let n = 0
    const flaky = vi.fn(async () => { n++; if (n === 2) throw new Error('read timeout'); return { tick: n, values: {} } })
    const res = await handleTrace({ varNames: ['counter'], samples: 3, intervalMs: 1 }, cfg, flaky)
    expect(res.success).toBe(true)
    expect(res.samples).toHaveLength(3)
    expect(res.samples[1].tick).toBeNull()
  })
  it('per-sample timeout defaults to 2000ms', async () => {
    let seen = -1
    const cap = vi.fn(async (_b: string, _t: string, _v: unknown, timeoutMs?: number) => { seen = timeoutMs ?? -1; return { tick: 1, values: {} } })
    await handleTrace({ varNames: ['counter'], samples: 1 }, cfg, cap)
    expect(seen).toBe(2000)
  })
  it('truncates sampling when the wall-clock budget is hit', async () => {
    const slow = vi.fn(async () => { await new Promise(r => setTimeout(r, 25)); return { tick: 1, values: {} } })
    const res = await handleTrace({ varNames: ['counter'], samples: 50, intervalMs: 1 }, cfg, slow, 60 /* maxWallMsOverride */)
    expect(res.samples.length).toBeLessThan(50)
    expect(res.note).toMatch(/截断|truncat/)
  })
})

// ── actual sampling resolution honesty ──────────────────────────────────────
// Each sample is a full debug-socket round trip (~50ms physical floor), so a
// requested intervalMs below that is silently unattainable — the agent believes
// it sampled at 30ms while actually getting ~80-100ms (aliasing, missed
// transients). Report the achieved resolution and, when the request was
// sub-floor, advise the ws-3 pivot: persistent-downstream assertion / pulseScans.
describe('handleTrace actual resolution', () => {
  it('reports actualIntervalMs computed from real elapsed time', async () => {
    const snap = makeSnapshotMock()
    const result = await handleTrace({ samples: 3, intervalMs: 10 }, cfg, snap)
    expect(result.actualIntervalMs).toBeTypeOf('number')
    expect(result.actualIntervalMs!).toBeGreaterThan(0)
  })

  it('sub-floor request (intervalMs below achievable): note advises verifyBehavior/pulseScans pivot', async () => {
    // Simulate the ~50ms read cost: each snapshot takes ~30ms, so requested 10ms → actual ~40ms.
    let tick = 100
    const slowSnap = vi.fn(async (_b: string, _t: string, vars: VariableEntry[]) => {
      await new Promise(r => setTimeout(r, 30))
      const values: Record<string, VariableValue> = {}
      for (const v of vars) values[v.name] = { value: 0, type: 'INT', index: v.index, location: v.location }
      tick += 2
      return { tick, values }
    })
    const result = await handleTrace({ samples: 4, intervalMs: 10 }, cfg, slowSnap)
    expect(result.note).toMatch(/实际平均采样周期/)
    expect(result.note).toMatch(/verifyBehavior/)
    expect(result.note).toMatch(/pulseScans/)
  })

  it('honest request (achievable interval): no resolution advisory', async () => {
    const snap = makeSnapshotMock()
    const result = await handleTrace({ samples: 2, intervalMs: 150 }, cfg, snap)
    expect(result.note ?? '').not.toMatch(/实际平均采样周期/)
  })
})
