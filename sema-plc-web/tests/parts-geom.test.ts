import { describe, it, expect } from 'vitest'
import { PART_GEOM, PART_REGISTRY } from '../src/components/sim/parts'

// These numbers MUST track the SVG markup in parts.tsx. The Conveyor frame rect is
// <rect x=0 y=20 width=120 height=14>, so the belt face spans x∈[0,120] and its
// centerline is y = 20 + 14/2 = 27. The SensorButton bg rect is
// <rect x=2 y=6 width=44 height=32>, so its bbox is w=2+44+2=48, h=6+32=38.
// If the SVG changes, update both — this test is the tripwire that forces it.
describe('PART_GEOM', () => {
  it('conveyor geometry matches the SVG belt face', () => {
    const c = PART_GEOM.conveyor
    expect(c.w).toBe(120)
    expect(c.axis).toEqual({ from: { x: 0, y: 27 }, to: { x: 120, y: 27 } })
  })
  it('sensor-button w/h match its SVG bounding box', () => {
    expect(PART_GEOM['sensor-button'].w).toBe(48)
    expect(PART_GEOM['sensor-button'].h).toBe(38)
  })
  it('lamp exposes a positive bounding box', () => {
    expect(PART_GEOM.lamp.w).toBeGreaterThan(0)
    expect(PART_GEOM.lamp.h).toBeGreaterThan(0)
  })
  it('every PART_REGISTRY kind has a geometry entry', () => {
    for (const kind of Object.keys(PART_REGISTRY)) {
      expect(PART_GEOM[kind], `missing geom for "${kind}"`).toBeDefined()
    }
  })
})
