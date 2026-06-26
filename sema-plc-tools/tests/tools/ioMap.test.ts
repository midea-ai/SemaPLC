import { describe, it, expect } from 'vitest'
import { parseIoMap, applyIoMap } from '../../src/tools/ioMap.js'
import type { DetectedIO } from '../../src/types.js'

const IO: DetectedIO[] = [
  { name: 'red_led', address: '%QX0.0', type: 'BOOL', direction: 'output', modbusType: 'coil', modbusAddr: 0 },
  { name: 'level', address: '%QW0', type: 'INT', direction: 'output', modbusType: 'holding_register', modbusAddr: 0 },
]

describe('parseIoMap', () => {
  it('parses component + label entries keyed by symbol name', () => {
    const m = parseIoMap('red_led:\n  component: lamp\n  label: 红灯\nlevel: { component: tank }\n')
    expect(m).toEqual({ red_led: { component: 'lamp', label: '红灯' }, level: { component: 'tank' } })
  })
  it('returns {} for empty / whitespace', () => {
    expect(parseIoMap('')).toEqual({})
    expect(parseIoMap('   \n')).toEqual({})
  })
  it('returns {} for invalid yaml without throwing', () => {
    expect(parseIoMap('{[}')).toEqual({})
  })
  it('returns {} for a non-object document (a bare list)', () => {
    expect(parseIoMap('- a\n- b\n')).toEqual({})
  })
  it('ignores non-string component values', () => {
    expect(parseIoMap('x:\n  component: 5\n')).toEqual({ x: {} })
  })
})

describe('applyIoMap', () => {
  it('fills component from the map, leaving unmapped IO untouched', () => {
    const out = applyIoMap(IO, { red_led: { component: 'tank' } })
    expect(out[0].component).toBe('tank')
    expect(out[1].component).toBeUndefined()
  })
  it('is pure — does not mutate the input', () => {
    applyIoMap(IO, { red_led: { component: 'tank' } })
    expect(IO[0].component).toBeUndefined()
  })
  it('leaves IO unchanged when the map is empty', () => {
    expect(applyIoMap(IO, {})).toEqual(IO)
  })
})
