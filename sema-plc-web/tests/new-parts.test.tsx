import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PART_REGISTRY } from '../src/components/sim/parts'
import { resolveEffect, applyPatch } from '../src/components/sim/resolveEffect'

function renderPart(kind: string) {
  const comp = PART_REGISTRY[kind]
  const { container } = render(<svg>{comp({})}</svg>)
  return container.querySelector('svg')!
}

describe('new library parts', () => {
  it('registers gauge/pump/hopper/stack-light', () => {
    for (const k of ['gauge', 'pump', 'hopper', 'stack-light']) expect(PART_REGISTRY[k]).toBeTypeOf('function')
  })

  it('gauge needle rotates AROUND the pivot: needle sits inside a translate(cx,cy) group', () => {
    const svg = renderPart('gauge')
    const needle = svg.querySelector('[data-anchor="primary"]')!
    const parentG = needle.closest('g[transform]')!
    expect(parentG.getAttribute('transform')).toMatch(/translate\(\s*\d+(\.\d+)?\s*,\s*\d+(\.\d+)?\s*\)/)
    applyPatch(needle, resolveEffect({ type: 'rotate', degPerUnit: 1.8 }, 50))
    expect(needle.getAttribute('transform')).toBe('rotate(90)')
  })

  it('pump primary carries sim-rotor base class and gains sim-run on class effect', () => {
    const svg = renderPart('pump')
    const rotor = svg.querySelector('[data-anchor="primary"]')!
    expect(rotor.getAttribute('data-base-class')).toBe('sim-rotor')
    applyPatch(rotor, resolveEffect({ type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] }, true))
    expect(rotor.getAttribute('class')).toMatch(/\bsim-run\b/)
  })

  it('hopper level rect grows via height effect', () => {
    const svg = renderPart('hopper')
    const level = svg.querySelector('[data-anchor="primary"]')!
    applyPatch(level, resolveEffect({ type: 'height', valueFrom: 0, valueTo: 100, from: 0, to: 56 }, 50))
    expect(Number(level.getAttribute('height'))).toBeCloseTo(28, 0)
  })

  it('stack-light has three independently-fillable named anchors', () => {
    const svg = renderPart('stack-light')
    for (const seg of ['red', 'amber', 'green']) {
      const el = svg.querySelector(`[data-anchor="${seg}"]`)!
      expect(el, seg).not.toBeNull()
      applyPatch(el, resolveEffect({ type: 'fill', map: [{ when: { eq: true }, color: '#abcdef' }] }, true))
      expect(el.getAttribute('fill')).toBe('#abcdef')
    }
  })
})
