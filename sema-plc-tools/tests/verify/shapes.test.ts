import { describe, it, expect } from 'vitest'
import { judgeShape } from '../../src/verify/shapes.js'

const j = (samples: any[], shape: any) => judgeShape(samples, shape)

describe('judgeShape', () => {
  it('changed: fails on a dead flat series, passes when ≥2 distinct values', () => {
    expect(j([0, 0, 0, 0], { var: 's', kind: 'changed' }).ok).toBe(false)
    expect(j([0, 0, 1, 0], { var: 's', kind: 'changed' }).ok).toBe(true)
    expect(j([null, 0, null, 0], { var: 's', kind: 'changed' }).ok).toBe(false)
  })
  it('range: all numeric samples within [min,max]; nulls ignored', () => {
    expect(j([10, 55, 90, null], { var: 's', kind: 'range', min: 0, max: 100 }).ok).toBe(true)
    const r = j([10, 120], { var: 's', kind: 'range', min: 0, max: 100 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/120/)
  })
  it('settle: tail portion within band (PID 收敛), head may overshoot', () => {
    const series = [0, 30, 80, 110, 95, 100, 101, 99, 100, 100]
    expect(j(series, { var: 's', kind: 'settle', min: 95, max: 105 }).ok).toBe(true)
    expect(j([0, 30, 80, 110, 140, 150, 160, 170, 180, 190], { var: 's', kind: 'settle', min: 95, max: 105 }).ok).toBe(false)
  })
  it('cycle: collapsed series must follow the cyclic order, ≥2 transitions', () => {
    expect(j([0, 0, 1, 1, 2, 2, 0, 0], { var: 's', kind: 'cycle', sequence: [0, 1, 2] }).ok).toBe(true)
    expect(j([0, 0, 0], { var: 's', kind: 'cycle', sequence: [0, 1, 2] }).ok).toBe(false)
    const r = j([0, 2, 1, 0], { var: 's', kind: 'cycle', sequence: [0, 1, 2] })
    expect(r.ok).toBe(false)
    expect(r.observed).toEqual([0, 2, 1, 0])
  })
  it('cycle: entry point may be mid-cycle (1→2→0→1 valid for [0,1,2])', () => {
    expect(j([1, 2, 0, 1], { var: 's', kind: 'cycle', sequence: [0, 1, 2] }).ok).toBe(true)
  })
})

describe('judgeShape guards', () => {
  it('range: all-null / non-numeric samples must NOT silently pass', () => {
    expect(j([null, null], { var: 's', kind: 'range', min: 0, max: 100 }).ok).toBe(false)
    expect(j(['abc', 'def'], { var: 's', kind: 'range', min: 0, max: 100 }).ok).toBe(false)
  })
})
