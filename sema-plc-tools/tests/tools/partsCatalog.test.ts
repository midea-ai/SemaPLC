import { describe, it, expect } from 'vitest'
import { PART_KINDS, PART_BOXES, PARTS_CATALOG_MD, REQUIRES_MANUAL_LAYOUT } from '../../src/tools/partsCatalog.js'

describe('plc-tools parts catalog copy', () => {
  it('PART_KINDS holds the 13 native kinds', () => {
    expect([...PART_KINDS].sort()).toEqual(
      ['conveyor', 'cylinder', 'gauge', 'hopper', 'lamp', 'motor', 'numeric-display',
       'pump', 'sensor-button', 'slider', 'stack-light', 'tank', 'valve'].sort(),
    )
  })
  it('PART_BOXES has a w/h box for every kind', () => {
    for (const k of PART_KINDS) {
      expect(PART_BOXES[k], `box for ${k}`).toBeDefined()
      expect(typeof PART_BOXES[k].w).toBe('number')
      expect(typeof PART_BOXES[k].h).toBe('number')
    }
  })
  it('PARTS_CATALOG_MD lists every kind as a bullet line', () => {
    for (const k of PART_KINDS) expect(PARTS_CATALOG_MD).toContain(`\`${k}\``)
  })
  it('exposes REQUIRES_MANUAL_LAYOUT containing stack-light', () => {
    expect(REQUIRES_MANUAL_LAYOUT.has('stack-light')).toBe(true)
  })
})
