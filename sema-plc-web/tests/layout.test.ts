import { describe, it, expect } from 'vitest'
import { resolveLayout, alongPosition } from '../src/components/sim/layout'
import type { SceneSpec } from '../shared/protocol'

const close = (a: number, b: number) => Math.abs(a - b) < 1e-6

describe('resolveLayout', () => {
  it('returns the raw x/y/rotation for parts without snap (byte-for-byte fallback)', () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 200 },
      parts: [{ id: 'a', kind: 'lamp', x: 30, y: 40, rotation: 15, bindings: [] }],
    }
    expect(resolveLayout(scene).get('a')).toEqual({ x: 30, y: 40, rotation: 15 })
  })

  it('snap with no parent rotation is a plain offset', () => {
    const scene: SceneSpec = {
      version: '2', canvas: { width: 200, height: 200 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 100, y: 50, bindings: [] },
        { id: 'box', kind: 'lamp', x: 0, y: 0, snap: { to: 'belt', dx: 20, dy: -6 }, bindings: [] },
      ],
    }
    expect(resolveLayout(scene).get('box')).toEqual({ x: 120, y: 44, rotation: 0 })
  })

  it('snap composes with parent rotation (affine, not scalar add)', () => {
    // parent at (100,50) rotated 90°: offset (10,0) rotates to (0,10).
    const scene: SceneSpec = {
      version: '2', canvas: { width: 300, height: 300 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 100, y: 50, rotation: 90, bindings: [] },
        { id: 'box', kind: 'lamp', x: 0, y: 0, snap: { to: 'belt', dx: 10, dy: 0 }, bindings: [] },
      ],
    }
    const r = resolveLayout(scene).get('box')!
    expect(close(r.x, 100)).toBe(true)
    expect(close(r.y, 60)).toBe(true)
    expect(r.rotation).toBe(0)
  })

  it('rotation:30 numeric case', () => {
    const rad = (30 * Math.PI) / 180
    const scene: SceneSpec = {
      version: '2', canvas: { width: 300, height: 300 },
      parts: [
        { id: 'p', kind: 'conveyor', x: 0, y: 0, rotation: 30, bindings: [] },
        { id: 'c', kind: 'lamp', x: 0, y: 0, snap: { to: 'p', dx: 40, dy: 0 }, bindings: [] },
      ],
    }
    const r = resolveLayout(scene).get('c')!
    expect(close(r.x, 40 * Math.cos(rad))).toBe(true)
    expect(close(r.y, 40 * Math.sin(rad))).toBe(true)
  })

  it('falls back to raw x/y on a snap cycle (each node keeps its OWN raw coords)', () => {
    const scene: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [
        { id: 'a', kind: 'lamp', x: 1, y: 2, snap: { to: 'b', dx: 5, dy: 5 }, bindings: [] },
        { id: 'b', kind: 'lamp', x: 3, y: 4, snap: { to: 'a', dx: 5, dy: 5 }, bindings: [] },
      ],
    }
    const m = resolveLayout(scene)
    expect(m.get('a')).toEqual({ x: 1, y: 2, rotation: 0 })
    expect(m.get('b')).toEqual({ x: 3, y: 4, rotation: 0 })
  })

  it('falls back to raw x/y when snap.to is missing', () => {
    const scene: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [{ id: 'x', kind: 'lamp', x: 7, y: 8, snap: { to: 'ghost', dx: 1, dy: 1 }, bindings: [] }],
    }
    expect(resolveLayout(scene).get('x')).toEqual({ x: 7, y: 8, rotation: 0 })
  })

  it('falls back to raw x/y on a self-referential snap', () => {
    const scene: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [{ id: 's', kind: 'lamp', x: 9, y: 9, snap: { to: 's', dx: 4, dy: 4 }, bindings: [] }],
    }
    expect(resolveLayout(scene).get('s')).toEqual({ x: 9, y: 9, rotation: 0 })
  })
})

describe('alongPosition', () => {
  const host = { x: 100, y: 50, rotation: 0 }

  it('t=0 sits at the axis start (host origin + from)', () => {
    expect(alongPosition(host, 'conveyor', 'x', 0)).toEqual({ x: 100, y: 77 })
  })
  it('t=0.5 sits mid-axis', () => {
    expect(alongPosition(host, 'conveyor', 'x', 0.5)).toEqual({ x: 160, y: 77 })
  })
  it('t=1 sits at the axis end', () => {
    expect(alongPosition(host, 'conveyor', 'x', 1)).toEqual({ x: 220, y: 77 })
  })
  it('clamps t outside [0,1]', () => {
    expect(alongPosition(host, 'conveyor', 'x', 2)).toEqual({ x: 220, y: 77 })
    expect(alongPosition(host, 'conveyor', 'x', -1)).toEqual({ x: 100, y: 77 })
  })
  it('rotates the axis with the host rotation (90°)', () => {
    const r = alongPosition({ x: 0, y: 0, rotation: 90 }, 'conveyor', 'x', 1)
    expect(close(r.x, -27)).toBe(true)   // local (120,27) rotated 90° → (-27,120)
    expect(close(r.y, 120)).toBe(true)
  })
})
