import { describe, it, expect } from 'vitest'
import { resolveEffect } from '../src/components/sim/resolveEffect'
import type { Effect } from '../shared/protocol'

describe('resolveEffect', () => {
  it('fill: picks the color of the first matching range, else null', () => {
    const e: Effect = { type: 'fill', map: [
      { when: { eq: false }, color: '#999' }, { when: { eq: true }, color: '#0f0' },
    ] }
    expect(resolveEffect(e, true)).toEqual({ kind: 'fill', color: '#0f0' })
    expect(resolveEffect(e, false)).toEqual({ kind: 'fill', color: '#999' })
    expect(resolveEffect({ type: 'fill', map: [] }, 1)).toEqual({ kind: 'fill', color: null })
  })
  it('visible: hidden when the match fails', () => {
    const e: Effect = { type: 'visible', when: { truthy: true } }
    expect(resolveEffect(e, 1)).toEqual({ kind: 'visible', hidden: false })
    expect(resolveEffect(e, 0)).toEqual({ kind: 'visible', hidden: true })
  })
  it('text: formats {v}', () => {
    expect(resolveEffect({ type: 'text', format: '{v} pcs' }, 7)).toEqual({ kind: 'text', text: '7 pcs' })
    expect(resolveEffect({ type: 'text' }, 42)).toEqual({ kind: 'text', text: '42' })
  })
  it('height: linearly maps value→attr, clamped', () => {
    const e: Effect = { type: 'height', valueFrom: 0, valueTo: 100, from: 0, to: 50 }
    expect(resolveEffect(e, 50)).toEqual({ kind: 'attr', name: 'height', value: 25 })
    expect(resolveEffect(e, 200)).toEqual({ kind: 'attr', name: 'height', value: 50 }) // clamp
  })
  it('translateX: maps value→transform', () => {
    const e: Effect = { type: 'translateX', valueFrom: 0, valueTo: 10, from: 0, to: 100 }
    expect(resolveEffect(e, 5)).toEqual({ kind: 'transform', transform: 'translate(50,0)' })
  })
  it('rotate: degrees proportional to value', () => {
    expect(resolveEffect({ type: 'rotate', degPerUnit: 36 }, 2)).toEqual({ kind: 'transform', transform: 'rotate(72)' })
  })
  it('class: active className when matched, empty otherwise', () => {
    const e: Effect = { type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] }
    expect(resolveEffect(e, 1)).toEqual({ kind: 'class', className: 'sim-run' })
    expect(resolveEffect(e, 0)).toEqual({ kind: 'class', className: '' })
  })
})
