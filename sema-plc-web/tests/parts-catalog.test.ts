import { describe, it, expect } from 'vitest'
import { PARTS_CATALOG, PARTS_CATALOG_MD } from '../src/components/sim/partsCatalog'
import { PART_REGISTRY, PART_GEOM } from '../src/components/sim/parts'

describe('PARTS_CATALOG (frontend visual source of truth)', () => {
  it('has 13 kinds including the analog-input slider', () => {
    const kinds = PARTS_CATALOG.map((p) => p.kind)
    expect(kinds).toHaveLength(13)
    for (const k of ['gauge', 'pump', 'hopper', 'stack-light', 'slider']) expect(kinds).toContain(k)
  })
  it('every catalog kind has a render component and a geometry box', () => {
    for (const p of PARTS_CATALOG) {
      expect(PART_REGISTRY[p.kind], p.kind).toBeDefined()
      expect(PART_GEOM[p.kind], p.kind).toBeDefined()
    }
  })
  it('every part has a numeric w/h box', () => {
    for (const p of PARTS_CATALOG) {
      expect(typeof p.box.w, p.kind).toBe('number')
      expect(typeof p.box.h, p.kind).toBe('number')
    }
  })
  it('stack-light declares extraAnchors and requiresManualLayout', () => {
    const sl = PARTS_CATALOG.find((p) => p.kind === 'stack-light')!
    expect(sl.extraAnchors).toEqual(expect.arrayContaining(['red', 'amber', 'green']))
    expect(sl.requiresManualLayout).toBe(true)
  })
  it('gauge notes mention the needle pivot convention', () => {
    expect(PARTS_CATALOG.find((p) => p.kind === 'gauge')!.notes).toMatch(/轴心|pivot|translate/)
  })
  it('PARTS_CATALOG_MD lists every kind', () => {
    for (const p of PARTS_CATALOG) expect(PARTS_CATALOG_MD).toContain(`\`${p.kind}\``)
  })
})
