import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { handleForceVariables } from '../../src/tools/forceVariables.js'
import { serializeValue, buildForceCommand, parseForceResponse, isForceable } from '../../src/client/variables.js'
import type { PlcConfig } from '../../src/config.js'

const TMP_STATE = path.join(os.tmpdir(), `force-test-state-${Date.now()}.json`)
const cfg: PlcConfig = {
  url: 'https://localhost:8443', container: 'test-container',
  user: 'admin', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: TMP_STATE,
}

beforeEach(() => {
  // Seed state.json with a variableMap for handle to find
  fs.writeFileSync(TMP_STATE, JSON.stringify({
    lastCompile: {
      timestamp: '2026-05-21T00:00:00Z',
      stCode: 'PROGRAM x END_PROGRAM',
      zipPath: '/tmp/x.zip',
      variableMap: [
        { index: 0, name: 'start_button', type: 'BOOL', location: '%IX0.0' },
        { index: 1, name: 'setpoint',     type: 'INT',  location: '%IW0' },
        { index: 2, name: 'count',        type: 'DINT', location: '%QD0' },
        { index: 3, name: 'level',        type: 'REAL', location: '%QW1' },
        { index: 4, name: 'big',          type: 'LINT', location: '' },
        { index: 5, name: 'pt',           type: 'TIME', location: '' },
        { index: 6, name: 'speed',        type: 'INT',  location: '%QW2' },
      ],
    },
  }))
})
afterEach(() => {
  vi.restoreAllMocks()
  try { fs.unlinkSync(TMP_STATE) } catch {}
})

describe('serializeValue', () => {
  it('serializes BOOL true/false', () => {
    expect(serializeValue('BOOL', true)).toEqual([1])
    expect(serializeValue('BOOL', false)).toEqual([0])
  })
  it('serializes INT positive (LE 2 bytes)', () => {
    // 0x1234 = 4660 → LE: 34 12
    expect(serializeValue('INT', 0x1234)).toEqual([0x34, 0x12])
  })
  it('serializes INT negative (sign-extended LE)', () => {
    // -1 → 0xFFFF → LE: FF FF
    expect(serializeValue('INT', -1)).toEqual([0xff, 0xff])
    // INT min: -32768 → 0x8000 → LE: 00 80
    expect(serializeValue('INT', -32768)).toEqual([0x00, 0x80])
  })
  it('serializes DINT (LE 4 bytes)', () => {
    // 0x12345678 → LE: 78 56 34 12
    expect(serializeValue('DINT', 0x12345678)).toEqual([0x78, 0x56, 0x34, 0x12])
    // -1 → 0xFFFFFFFF
    expect(serializeValue('DINT', -1)).toEqual([0xff, 0xff, 0xff, 0xff])
  })
  it('serializes REAL (4 bytes IEEE 754 LE)', () => {
    // 1.0f = 0x3F800000 LE: 00 00 80 3F
    expect(serializeValue('REAL', 1.0)).toEqual([0x00, 0x00, 0x80, 0x3f])
  })
  it('serializes LREAL (8 bytes IEEE 754 LE)', () => {
    // 1.0 = 0x3FF0000000000000 LE: 00 00 00 00 00 00 F0 3F
    expect(serializeValue('LREAL', 1.0)).toEqual([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f])
  })
  it('serializes LINT from string (BigInt-safe)', () => {
    // 1000000000000 = 0xE8D4A51000 → LE: 00 10 A5 D4 E8 00 00 00
    expect(serializeValue('LINT', '1000000000000')).toEqual([0x00, 0x10, 0xa5, 0xd4, 0xe8, 0x00, 0x00, 0x00])
  })
  it('serializes TIME ms into IEC_TIMESPEC LE', () => {
    // T#1s500ms = 1500ms → sec=1, nsec=500_000_000
    // sec LE: 01 00 00 00; nsec=0x1DCD6500 LE: 00 65 CD 1D
    expect(serializeValue('TIME', 1500)).toEqual([0x01, 0x00, 0x00, 0x00, 0x00, 0x65, 0xcd, 0x1d])
  })
  it('rejects type/value mismatches', () => {
    expect(serializeValue('INT', true as any)).toBeNull()      // boolean as INT
    expect(serializeValue('INT', 99999)).toBeNull()             // out of range
    expect(serializeValue('SINT', -129)).toBeNull()             // SINT range -128..127
    expect(serializeValue('UNKNOWN', 5)).toBeNull()             // unknown type
  })

  // Real-world root cause: agents commonly pass values as strings. serializeValue
  // must coerce numeric strings before validation, and BOOL must map explicitly
  // (the naive `value ? 1 : 0` turned the string 'false' into TRUE).
  it('coerces integer numeric strings for INT', () => {
    // '42' → 0x002A → LE: 2A 00
    expect(serializeValue('INT', '42')).toEqual([0x2a, 0x00])
  })
  it('coerces numeric strings for other integer types', () => {
    expect(serializeValue('SINT', '-1')).toEqual([0xff])
    expect(serializeValue('DINT', '-1')).toEqual([0xff, 0xff, 0xff, 0xff])
  })
  it('rejects non-integer numeric strings for integer types', () => {
    expect(serializeValue('INT', '1.5')).toBeNull()
    expect(serializeValue('INT', '')).toBeNull()
    expect(serializeValue('INT', '  ')).toBeNull()
    expect(serializeValue('INT', 'abc')).toBeNull()
  })
  it('coerces numeric strings (incl. decimals) for REAL/LREAL', () => {
    expect(serializeValue('REAL', '1.0')).toEqual([0x00, 0x00, 0x80, 0x3f])
    expect(serializeValue('LREAL', '1.0')).toEqual([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f])
  })
  it('accepts REAL 1.5 (legal)', () => {
    const b = Buffer.alloc(4); b.writeFloatLE(1.5, 0)
    expect(serializeValue('REAL', '1.5')).toEqual([b[0], b[1], b[2], b[3]])
  })
  it('maps BOOL strings explicitly (no naive truthy coerce)', () => {
    expect(serializeValue('BOOL', 'true')).toEqual([1])
    expect(serializeValue('BOOL', 'TRUE')).toEqual([1])
    expect(serializeValue('BOOL', '1')).toEqual([1])
    expect(serializeValue('BOOL', 1)).toEqual([1])
    expect(serializeValue('BOOL', 'false')).toEqual([0])   // the bug: was [1]
    expect(serializeValue('BOOL', 'FALSE')).toEqual([0])
    expect(serializeValue('BOOL', '0')).toEqual([0])
    expect(serializeValue('BOOL', 0)).toEqual([0])
    expect(serializeValue('BOOL', '')).toEqual([0])
  })
  it('rejects unrecognized BOOL values', () => {
    expect(serializeValue('BOOL', 'xyz')).toBeNull()
    expect(serializeValue('BOOL', 2)).toBeNull()
  })
})

describe('buildForceCommand', () => {
  it('encodes BOOL=true at idx 0', () => {
    // [0x42, idx_hi, idx_lo, flag=1, len_hi, len_lo, value...]
    // idx 0 → 00 00; flag 1 → 01; len 1 → 00 01; value [01]
    expect(buildForceCommand(0, 1, [0x01])).toBe('42 00 00 01 00 01 01')
  })
  it('encodes release frame (flag=0)', () => {
    // idx 5 → 00 05; flag 0 → 00; len 2 → 00 02; value [00 00]
    expect(buildForceCommand(5, 0, [0x00, 0x00])).toBe('42 00 05 00 00 02 00 00')
  })
  it('encodes INT value with proper LE byte order in value section', () => {
    // idx 1 INT=42 → 0x002A → LE: 2A 00; frame: 42 00 01 01 00 02 2A 00
    expect(buildForceCommand(1, 1, [0x2a, 0x00])).toBe('42 00 01 01 00 02 2A 00')
  })
  it('encodes large index (BE) correctly', () => {
    // idx 0x0123 = 291 → BE: 01 23
    expect(buildForceCommand(0x0123, 1, [0x55])).toBe('42 01 23 01 00 01 55')
  })
})

describe('parseForceResponse', () => {
  it('returns null on 0x42 0x7E success', () => {
    expect(parseForceResponse('42 7E')).toBeNull()
  })
  it('returns error on unexpected header', () => {
    expect(parseForceResponse('44 7E')).toMatch(/bad response/)
  })
  it('returns error on runtime rejection (non-7E second byte)', () => {
    expect(parseForceResponse('42 80')).toMatch(/runtime rejected: code 0x80/)
  })
  it('returns error on empty input', () => {
    expect(parseForceResponse('')).toMatch(/empty response/)
  })
})

describe('isForceable', () => {
  // 2026-06-05 empirically re-verified against the live runtime (force_var DOES handle
  // every located elementary type, %I input and %Q output alike; the old "only BOOL+INT_O"
  // claim was a never-tested inference). Forceable = located (%I/%Q) + elementary type.
  it('all located elementary types forceable, both %I input and %Q output', () => {
    expect(isForceable('BOOL', '%IX0.0')).toBe(true)
    expect(isForceable('BOOL', '%QX0.0')).toBe(true)
    expect(isForceable('INT', '%QW0')).toBe(true)
    expect(isForceable('INT', '%IW0')).toBe(true)      // INT input — NOW forceable (was the bug)
    expect(isForceable('UINT', '%IW0')).toBe(true)
    expect(isForceable('WORD', '%IW0')).toBe(true)
    expect(isForceable('SINT', '%IB1')).toBe(true)
    expect(isForceable('DINT', '%QD0')).toBe(true)
    expect(isForceable('UDINT', '%ID2')).toBe(true)
    expect(isForceable('REAL', '%ID4')).toBe(true)
    expect(isForceable('REAL', '%QD4')).toBe(true)
    expect(isForceable('LINT', '%IL1')).toBe(true)
    expect(isForceable('LREAL', '%QL4')).toBe(true)
  })
  it('internal (non-located) vars are not forceable — force only targets %I/%Q image', () => {
    expect(isForceable('BOOL', '')).toBe(false)
    expect(isForceable('INT', '')).toBe(false)
    expect(isForceable('TIME', '')).toBe(false)
  })
  it('unknown/unsupported types are not forceable even when located', () => {
    expect(isForceable('STRING', '%IW0')).toBe(false)
    expect(isForceable('TIME', '%IL0')).toBe(false)    // not empirically verified → excluded
  })
})

describe('handleForceVariables', () => {
  it('forces a BOOL input and an INT output in one call, mocked forceFn', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)  // null = success
    const r = await handleForceVariables(
      { set: { start_button: true, speed: 42 } },
      cfg,
      mockForce,
    )
    expect(r.success).toBe(true)
    expect(r.forced).toHaveLength(2)
    expect(r.forced[0]).toMatchObject({ name: 'start_button', index: 0, type: 'BOOL', value: true })
    expect(r.forced[1]).toMatchObject({ name: 'speed', index: 6, type: 'INT', value: 42 })
    expect(r.failed).toEqual([])
    // Confirm correct frame contents passed to forceFn
    expect(mockForce).toHaveBeenNthCalledWith(1, cfg.url, '', 0, 1, [1], 5000)
    expect(mockForce).toHaveBeenNthCalledWith(2, cfg.url, '', 6, 1, [0x2a, 0x00], 5000)
  })

  it('forces INT input (%IW), DINT output (%QD) and REAL — all located types now forceable', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables(
      { set: { setpoint: 42, count: 1 } },  // setpoint INT %IW0 (input), count DINT %QD0 (output)
      cfg,
      mockForce,
    )
    expect(r.success).toBe(true)
    expect(r.forced.map(f => f.name).sort()).toEqual(['count', 'setpoint'])
    expect(r.failed).toEqual([])
    // INT input %IW0 (idx 1) → [42,0]; DINT output %QD0 (idx 2) → [1,0,0,0]
    expect(mockForce).toHaveBeenCalledWith(cfg.url, '', 1, 1, [0x2a, 0x00], 5000)
    expect(mockForce).toHaveBeenCalledWith(cfg.url, '', 2, 1, [1, 0, 0, 0], 5000)
  })

  it('resolves variable names case-insensitively (matiec lowercases; IEC identifiers are case-insensitive)', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    // variableMap has 'start_button' (lowercase, as matiec emits); force with mixed case.
    const r = await handleForceVariables({ set: { Start_Button: true } }, cfg, mockForce)
    expect(r.success).toBe(true)
    expect(r.failed).toEqual([])
    expect(r.forced[0]).toMatchObject({ name: 'start_button', index: 0, value: true })  // canonical name
    expect(mockForce).toHaveBeenCalledWith(cfg.url, '', 0, 1, [1], 5000)
  })

  it('rejects internal (non-located) vars as not forceable, before any roundtrip', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables(
      { set: { big: 100, pt: 500 } },  // big LINT '' (internal), pt TIME '' (internal)
      cfg,
      mockForce,
    )
    expect(r.success).toBe(false)
    expect(r.forced).toEqual([])
    expect(r.failed.map(f => f.name).sort()).toEqual(['big', 'pt'])
    for (const f of r.failed) expect(f.reason).toMatch(/not forceable/)
    // Non-forceable vars must NOT consume a WebSocket roundtrip
    expect(mockForce).not.toHaveBeenCalled()
  })

  it('reports unresolved variable names without aborting other operations', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables(
      { set: { start_button: true, nonexistent: 99 } },
      cfg,
      mockForce,
    )
    expect(r.success).toBe(false)
    expect(r.forced).toHaveLength(1)
    expect(r.forced[0].name).toBe('start_button')
    expect(r.failed).toEqual([{ name: 'nonexistent', reason: 'variable not found in variableMap' }])
    // Failed name resolution should NOT consume a WebSocket roundtrip
    expect(mockForce).toHaveBeenCalledTimes(1)
  })

  it('reports type mismatch failures', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables(
      { set: { setpoint: true as any } },  // BOOL into INT
      cfg,
      mockForce,
    )
    expect(r.success).toBe(false)
    expect(r.forced).toEqual([])
    expect(r.failed[0].reason).toMatch(/cannot serialize/)
    expect(mockForce).not.toHaveBeenCalled()
  })

  it('reports runtime force failure (e.g. WebSocket timeout)', async () => {
    const mockForce = vi.fn().mockResolvedValue('WebSocket force timed out after 5000ms')
    const r = await handleForceVariables({ set: { start_button: true } }, cfg, mockForce)
    expect(r.success).toBe(false)
    expect(r.forced).toEqual([])
    expect(r.failed).toEqual([{ name: 'start_button', reason: 'WebSocket force timed out after 5000ms' }])
  })

  it('handles release with correct byte count per type', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables(
      { release: ['start_button', 'count', 'big'] },  // BOOL=1, DINT=4, LINT=8
      cfg,
      mockForce,
    )
    expect(r.success).toBe(true)
    expect(r.released).toEqual(['start_button', 'count', 'big'])
    // signature: (url, token, idx, flag, valueBytes, timeoutMs). Release is flag=0.
    // BOOL: 1 byte zeros
    expect(mockForce).toHaveBeenNthCalledWith(1, cfg.url, '', 0, 0, [0], 5000)
    // DINT: 4 byte zeros
    expect(mockForce).toHaveBeenNthCalledWith(2, cfg.url, '', 2, 0, [0, 0, 0, 0], 5000)
    // LINT: 8 byte zeros
    expect(mockForce).toHaveBeenNthCalledWith(3, cfg.url, '', 4, 0, [0, 0, 0, 0, 0, 0, 0, 0], 5000)
  })

  it('handles set + release in same call', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables(
      { set: { start_button: true }, release: ['setpoint'] },
      cfg,
      mockForce,
    )
    expect(r.success).toBe(true)
    expect(r.forced).toHaveLength(1)
    expect(r.released).toEqual(['setpoint'])
    expect(mockForce).toHaveBeenCalledTimes(2)
  })

  it('returns success: true with empty input (no-op)', async () => {
    const mockForce = vi.fn().mockResolvedValue(null)
    const r = await handleForceVariables({}, cfg, mockForce)
    expect(r.success).toBe(true)
    expect(r.forced).toEqual([])
    expect(r.released).toEqual([])
    expect(mockForce).not.toHaveBeenCalled()
  })

  it('returns errorMessage when state.json has no variableMap', async () => {
    fs.writeFileSync(TMP_STATE, JSON.stringify({ lastCompile: null }))
    const r = await handleForceVariables({ set: { x: 1 } }, cfg, vi.fn())
    expect(r.success).toBe(false)
    expect(r.errorMessage).toMatch(/Run plc.compile first/)
  })
})

describe('pulseMs (auto-release after delay)', () => {
  it('sets variables then auto-releases after pulseMs', async () => {
    const calls: Array<{ flag: 0 | 1; idx: number }> = []
    const forceFn = vi.fn(async (_url: string, _token: string, idx: number, flag: 0 | 1) => {
      calls.push({ flag, idx })
      return null
    })
    fs.writeFileSync(TMP_STATE, JSON.stringify({
      lastCompile: { timestamp: '', stCode: '', zipPath: '', variableMap: [
        { index: 0, name: 'start_button', type: 'BOOL', location: '%IX0.0' },
      ] },
    }))
    const r = await handleForceVariables({ set: { start_button: true }, pulseMs: 50 }, cfg, forceFn)
    expect(r.success).toBe(true)
    expect(r.forced.length).toBe(1)
    expect(r.released).toContain('start_button')
    // first call is set (flag=1), last call is release (flag=0)
    expect(calls[0].flag).toBe(1)
    expect(calls[calls.length - 1].flag).toBe(0)
  })

  it('pulseMs is ignored when only release is provided (no set)', async () => {
    const forceFn = vi.fn(async () => null)
    fs.writeFileSync(TMP_STATE, JSON.stringify({
      lastCompile: { timestamp: '', stCode: '', zipPath: '', variableMap: [
        { index: 0, name: 'start_button', type: 'BOOL', location: '%IX0.0' },
      ] },
    }))
    const r = await handleForceVariables({ release: ['start_button'], pulseMs: 50 }, cfg, forceFn)
    expect(r.success).toBe(true)
    // Only 1 call (the release), no extra auto-release
    expect(forceFn).toHaveBeenCalledTimes(1)
  })
})

// ── pulseScans: tick-verified minimal pulse ─────────────────────────────────
// d9462cc9 forensics: blind wall-clock pulseMs cannot prove the program ever
// scanned the forced value (a too-short pulse straddles zero scan boundaries →
// no edge was produced, silently). pulseScans polls the runtime tick and only
// releases after it advanced ≥N scans, returning the tick evidence.
describe('handleForceVariables pulseScans', () => {
  const mkSnapshot = (ticks: Array<number | null>) => {
    let i = 0
    return vi.fn().mockImplementation(async () => ({
      tick: ticks[Math.min(i++, ticks.length - 1)],
      values: {},
    }))
  }

  it('holds the force until tick advances ≥ pulseScans, then releases, with verified evidence', async () => {
    const forceFn = vi.fn().mockResolvedValue(null)
    const snapshotFn = mkSnapshot([100, 100, 101, 102])  // start=100, advances to 102
    const r = await handleForceVariables(
      { set: { start_button: true }, pulseScans: 2 },
      cfg, forceFn, snapshotFn,
    )
    expect(r.success).toBe(true)
    expect(r.released).toEqual(['start_button'])
    expect(r.pulse).toMatchObject({ startTick: 100, releaseTick: 102, scansHeld: 2, verified: true })
    // force (flag=1) then release (flag=0)
    expect(forceFn).toHaveBeenCalledWith(cfg.url, '', 0, 1, [1], 5000)
    expect(forceFn).toHaveBeenCalledWith(cfg.url, '', 0, 0, [0], 5000)
  })

  it('stalled runtime (tick never advances): releases anyway, verified=false with note', async () => {
    const forceFn = vi.fn().mockResolvedValue(null)
    const snapshotFn = mkSnapshot([100])  // tick frozen at 100
    const r = await handleForceVariables(
      { set: { start_button: true }, pulseScans: 2, timeoutMs: 200 },
      cfg, forceFn, snapshotFn,
    )
    expect(r.released).toEqual(['start_button'])  // never leave a force latched
    expect(r.pulse?.verified).toBe(false)
    expect(r.pulse?.note).toMatch(/未推进|not advance/i)
  })

  it('debug socket not ready (tick null): falls back, verified=false', async () => {
    const forceFn = vi.fn().mockResolvedValue(null)
    const snapshotFn = mkSnapshot([null])
    const r = await handleForceVariables(
      { set: { start_button: true }, pulseScans: 1, timeoutMs: 200 },
      cfg, forceFn, snapshotFn,
    )
    expect(r.released).toEqual(['start_button'])
    expect(r.pulse?.verified).toBe(false)
    expect(r.pulse?.startTick).toBeNull()
  })

  it('pulseMs also gains tick evidence: verified=true when tick advanced across the sleep', async () => {
    const forceFn = vi.fn().mockResolvedValue(null)
    const snapshotFn = mkSnapshot([200, 205])
    const r = await handleForceVariables(
      { set: { start_button: true }, pulseMs: 30 },
      cfg, forceFn, snapshotFn,
    )
    expect(r.released).toEqual(['start_button'])
    expect(r.pulse).toMatchObject({ startTick: 200, releaseTick: 205, scansHeld: 5, verified: true })
  })
})

// ── when: condition-triggered force (atomic waitFor→force) ──────────────────
// sorter forensics: 26 plc_waitFor retries racing "force the sensor the moment
// part_pos==20" — the waitFor→force round trip (poll connect ~46ms + force
// connect ~30ms ≈ 3-5 scans) always lost the race. `when` polls and fires the
// force over ONE persistent debug socket, closing the gap to ~1 scan, and
// returns tick evidence of the actual gap.
describe('handleForceVariables when (condition-triggered force)', () => {
  it('fires the force when the condition is met, with tick evidence', async () => {
    const whenFn = vi.fn().mockResolvedValue({
      met: true, polls: 7, conditionValue: 20, tickAtMet: 500, tickAtForced: 501, forceErrors: [],
    })
    const r = await handleForceVariables(
      { set: { start_button: true }, when: { varName: 'setpoint', op: '==', value: 20 } },
      cfg, undefined, undefined, whenFn,
    )
    expect(r.success).toBe(true)
    expect(r.forced).toHaveLength(1)
    expect(r.when).toMatchObject({ met: true, tickAtMet: 500, tickAtForced: 501, gapScans: 1 })
    // condition var resolved to its entry; sets pre-serialized
    const [condVar, op, target, sets] = whenFn.mock.calls[0].slice(2)
    expect(condVar.name).toBe('setpoint')
    expect(op).toBe('==')
    expect(target).toBe(20)
    expect(sets).toEqual([{ idx: 0, valueBytes: [1] }])
  })

  it('condition never met: no force applied, success=false with reason', async () => {
    const whenFn = vi.fn().mockResolvedValue({
      met: false, polls: 42, conditionValue: 7, tickAtMet: null, tickAtForced: null, forceErrors: [],
    })
    const r = await handleForceVariables(
      { set: { start_button: true }, when: { varName: 'setpoint', op: '==', value: 20, timeoutMs: 1000 } },
      cfg, undefined, undefined, whenFn,
    )
    expect(r.success).toBe(false)
    expect(r.forced).toEqual([])
    expect(r.when?.met).toBe(false)
    expect(r.errorMessage).toMatch(/条件未/)
  })

  it('when + pulseScans compose: condition-triggered verified pulse', async () => {
    const whenFn = vi.fn().mockResolvedValue({
      met: true, polls: 3, conditionValue: true, tickAtMet: 800, tickAtForced: 801, forceErrors: [],
    })
    const forceFn = vi.fn().mockResolvedValue(null)        // used for the release
    const snapshotFn = (() => {
      let i = 0
      const ticks = [801, 802, 803]
      return vi.fn().mockImplementation(async () => ({ tick: ticks[Math.min(i++, 2)], values: {} }))
    })()
    const r = await handleForceVariables(
      { set: { start_button: true }, when: { varName: 'count', op: '>=', value: 5 }, pulseScans: 2 },
      cfg, forceFn, snapshotFn, whenFn,
    )
    expect(r.success).toBe(true)
    expect(r.when?.met).toBe(true)
    expect(r.released).toEqual(['start_button'])           // pulse released after hold
    expect(r.pulse?.verified).toBe(true)
  })

  it('unresolvable condition variable fails fast without polling', async () => {
    const whenFn = vi.fn()
    const r = await handleForceVariables(
      { set: { start_button: true }, when: { varName: 'no_such_var', op: '==', value: 1 } },
      cfg, undefined, undefined, whenFn,
    )
    expect(r.success).toBe(false)
    expect(whenFn).not.toHaveBeenCalled()
  })
})
