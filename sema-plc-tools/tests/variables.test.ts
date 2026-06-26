import { describe, it, expect } from 'vitest'
import { buildDebugCommand, parseDebugResponse, varSize, decodeValue } from '../src/client/variables.js'
import type { VariableEntry } from '../src/types.js'

// Helper: build a debug response payload hex string with the 10-byte header
// (0x44 0x7E [lastVarIdx u16 BE] [tick u32 BE] [responseSize u16 BE]) plus raw bytes.
function buildResp(rawBytes: number[]): string {
  const responseSize = rawBytes.length
  const header = [
    0x44, 0x7E,
    0x00, 0x00,             // lastVarIdx (unused by parser for our purposes)
    0x00, 0x00, 0x00, 0x00, // tick
    (responseSize >> 8) & 0xff, responseSize & 0xff,
  ]
  return [...header, ...rawBytes].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

describe('buildDebugCommand', () => {
  it('encodes 0x44 GET_LIST for single index', () => {
    // 0x44 = 68, count=1 → [44, 00, 01, 00, 00]
    expect(buildDebugCommand([0])).toBe('44 00 01 00 00')
  })

  it('encodes multiple indices', () => {
    // indices [0, 1] → 44 00 02 00 00 00 01
    expect(buildDebugCommand([0, 1])).toBe('44 00 02 00 00 00 01')
  })
})

describe('parseDebugResponse', () => {
  it('returns empty record for empty/invalid response', () => {
    expect(parseDebugResponse('', [])).toEqual({})
  })

  it('decodes TIME (IEC_TIMESPEC, 8 bytes LE) to milliseconds', () => {
    // T#1s500ms = 1 sec + 500_000_000 nsec
    // sec=1 LE: 01 00 00 00; nsec=500000000=0x1DCD6500 LE: 00 65 CD 1D
    const vars: VariableEntry[] = [{ index: 0, name: 'et', type: 'TIME', location: '' }]
    const result = parseDebugResponse(buildResp([0x01,0x00,0x00,0x00, 0x00,0x65,0xCD,0x1D]), vars)
    expect(result.et?.value).toBe(1500)
  })

  it('decodes TIME zero correctly', () => {
    const vars: VariableEntry[] = [{ index: 0, name: 'pt', type: 'TIME', location: '' }]
    const result = parseDebugResponse(buildResp([0,0,0,0, 0,0,0,0]), vars)
    expect(result.pt?.value).toBe(0)
  })

  it('decodes TIME with only nanoseconds (T#20ms)', () => {
    // T#20ms = 0 sec + 20_000_000 nsec = 0x01312D00 LE: 00 2D 31 01
    const vars: VariableEntry[] = [{ index: 0, name: 'pt', type: 'TIME', location: '' }]
    const result = parseDebugResponse(buildResp([0,0,0,0, 0x00,0x2D,0x31,0x01]), vars)
    expect(result.pt?.value).toBe(20)
  })

  it('decodes TIME with both sec and small nsec (T#3s)', () => {
    // 3 sec + 0 nsec
    const vars: VariableEntry[] = [{ index: 0, name: 'et', type: 'TIME', location: '' }]
    const result = parseDebugResponse(buildResp([0x03,0,0,0, 0,0,0,0]), vars)
    expect(result.et?.value).toBe(3000)
  })

  it('decodes TIME large value (no precision loss for ms-level)', () => {
    // 1_000_000 sec + 500_000_000 nsec = 1_000_000_500 ms
    // sec=1000000=0xF4240 LE: 40 42 0F 00
    const vars: VariableEntry[] = [{ index: 0, name: 'et', type: 'TIME', location: '' }]
    const result = parseDebugResponse(buildResp([0x40,0x42,0x0F,0x00, 0x00,0x65,0xCD,0x1D]), vars)
    expect(result.et?.value).toBe(1_000_000_500)
  })

  it('reads TIME with 8-byte stride, not 2 (regression: prior fallback used INT size)', () => {
    // Two TIME variables back-to-back. If varSize fell back to 2, the second
    // would read garbage from the first's bytes 2-3.
    const vars: VariableEntry[] = [
      { index: 0, name: 'a', type: 'TIME', location: '' },
      { index: 1, name: 'b', type: 'TIME', location: '' },
    ]
    // a = 1s = [01,00,00,00, 00,00,00,00]; b = 2s = [02,00,00,00, 00,00,00,00]
    const result = parseDebugResponse(
      buildResp([0x01,0,0,0,0,0,0,0, 0x02,0,0,0,0,0,0,0]),
      vars,
    )
    expect(result.a?.value).toBe(1000)
    expect(result.b?.value).toBe(2000)
  })
})

describe('decodeValue (extracted from parseDebugResponse — single decoding truth)', () => {
  it('BOOL/INT/REAL/TIME 与既有逐类型语义一致', () => {
    expect(decodeValue('BOOL', [1])).toBe(true)
    expect(decodeValue('INT', [0x34, 0x12])).toBe(0x1234)
    expect(decodeValue('INT', [0xff, 0xff])).toBe(-1)
    // TIME = IEC_TIMESPEC {i32 sec; i32 nsec} LE → ms
    // sec=2, nsec=0x1dcd6500=500_000_000 → 2*1000 + 500 = 2500
    expect(decodeValue('TIME', [2,0,0,0, 0x00,0x65,0xcd,0x1d])).toBe(2500)
  })

  it('REAL decodes IEEE754 LE; LINT goes through BigInt → string', () => {
    // 1.5f LE = 00 00 C0 3F
    expect(decodeValue('REAL', [0x00, 0x00, 0xc0, 0x3f])).toBe(1.5)
    // LINT 0x0102030405060708 LE → decimal string via BigInt.
    // NOTE: negative LINT (e.g. FF×8) is NOT asserted here — the pre-existing
    // decoder double sign-extends (JS `|` yields signed int32 halves, then the
    // explicit 2^64 subtraction fires again) and returns -18446744073709551617
    // for -1. This extraction is zero-behavior-change; the bug is tracked
    // separately, do not "fix" it silently here.
    expect(decodeValue('LINT', [0x08,0x07,0x06,0x05,0x04,0x03,0x02,0x01])).toBe('72623859790382856')
  })

  it('default: unknown type reads u16 LE (existing behavior)', () => {
    expect(decodeValue('SOMETHING_NEW', [0x34, 0x12])).toBe(0x1234)
  })
})

describe('varSize', () => {
  it('returns 8 for TIME/DATE/DT/TOD (IEC_TIMESPEC layout)', () => {
    expect(varSize('TIME')).toBe(8)
    expect(varSize('DATE')).toBe(8)
    expect(varSize('DT')).toBe(8)
    expect(varSize('TOD')).toBe(8)
  })

  it('keeps original sizes for primitive types', () => {
    expect(varSize('BOOL')).toBe(1)
    expect(varSize('INT')).toBe(2)
    expect(varSize('DINT')).toBe(4)
    expect(varSize('REAL')).toBe(4)
    expect(varSize('LREAL')).toBe(8)
    expect(varSize('LINT')).toBe(8)
  })

  it('falls back to 2 for unknown types (existing behavior)', () => {
    expect(varSize('SOMETHING_NEW')).toBe(2)
  })
})
