import type { SceneSpec, PartInstance } from '../../../shared/protocol'
import { PART_GEOM } from './parts'

export interface Pose { x: number; y: number; rotation: number }

// Rotate a local offset by `deg` (SVG rotate: clockwise, y-down) about the origin.
function rotate(dx: number, dy: number, deg: number): { x: number; y: number } {
  if (!deg) return { x: dx, y: dy }
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return { x: dx * c - dy * s, y: dx * s + dy * c }
}

// Mark every part that lies on (or feeds into) a snap cycle, via white/gray/black
// DFS coloring on the parent graph. A node whose snap.to is missing or self is its
// own terminal — not a cycle here (handled as plain fallback in resolveLayout).
// Returns the set of part ids that MUST fall back to their own raw coords.
function findCycleMembers(byId: Map<string, PartInstance>): Set<string> {
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  const onCycle = new Set<string>()
  for (const id of byId.keys()) color.set(id, WHITE)

  // Iterative DFS; on encountering a GRAY node we've found a back-edge → every
  // node currently on the active stack from that GRAY node onward is on the cycle.
  for (const start of byId.keys()) {
    if (color.get(start) !== WHITE) continue
    const stack: string[] = []
    const walk = (id: string): void => {
      color.set(id, GRAY)
      stack.push(id)
      const part = byId.get(id)!
      const to = part.snap?.to
      if (to && to !== id && byId.has(to)) {
        const cTo = color.get(to)
        if (cTo === WHITE) walk(to)
        else if (cTo === GRAY) {
          // back-edge to `to`: mark the active-stack tail from `to` as on-cycle.
          const at = stack.lastIndexOf(to)
          for (let i = at; i < stack.length; i++) onCycle.add(stack[i])
        }
      }
      color.set(id, BLACK)
      stack.pop()
    }
    walk(start)
  }
  return onCycle
}

/**
 * Resolve every part to an absolute {x,y,rotation}. Parts without `snap` map
 * byte-for-byte to their raw x/y/rotation. A part with `snap` is placed at
 *   child.abs = parent.abs + R(parent.rotation)·(dx, dy)
 * resolved transitively. Parts on a snap cycle, with a missing parent, or with a
 * self-snap each fall back to THEIR OWN raw x/y (never throws, never loops).
 * Independent of validateSceneSpec.
 */
export function resolveLayout(scene: SceneSpec): Map<string, Pose> {
  // 防御:scene 退化时 parts 可能不是数组(直写/坏 buildSimulation)——for...of 会抛,
  // 而本函数在 SimRuntime 的 useMemo(render 阶段)调用,抛了就整页白屏。归一为空数组。
  const list = Array.isArray(scene.parts) ? scene.parts : []
  const byId = new Map<string, PartInstance>()
  for (const p of list) if (p?.id) byId.set(p.id, p)

  const onCycle = findCycleMembers(byId)
  const out = new Map<string, Pose>()

  const resolve = (id: string): Pose => {
    const cached = out.get(id)
    if (cached) return cached
    const part = byId.get(id)!
    const raw: Pose = { x: part.x, y: part.y, rotation: part.rotation ?? 0 }

    const parentId = part.snap?.to
    const noParent = !parentId || parentId === id || !byId.has(parentId)
    if (noParent || onCycle.has(id)) {
      out.set(id, raw)
      return raw
    }
    const parent = resolve(parentId)
    const off = rotate(part.snap!.dx, part.snap!.dy, parent.rotation)
    const pose: Pose = { x: parent.x + off.x, y: parent.y + off.y, rotation: raw.rotation }
    out.set(id, pose)
    return pose
  }

  for (const p of list) if (p?.id) resolve(p.id)
  return out
}

const clamp01 = (t: number) => Math.max(0, Math.min(1, t))

/**
 * Absolute position of a workpiece flowing along `host`'s local axis at parameter
 * t∈[0,1] (clamped). The axis comes from PART_GEOM[kind].axis (conveyor); parts
 * without an explicit axis use their bounding-box mid-line. The local point is
 * rotated by host.rotation and translated by host.{x,y}. `axis` selects which
 * spatial axis when a kind has no explicit segment (P1 conveyor ignores it).
 */
export function alongPosition(host: Pose, kind: string, axis: 'x' | 'y', t: number): { x: number; y: number } {
  void axis   // reserved: P1 conveyor uses its explicit horizontal axis segment.
  const geom = PART_GEOM[kind]
  const seg = geom?.axis ?? {
    from: { x: 0, y: (geom?.h ?? 0) / 2 },
    to: { x: geom?.w ?? 0, y: (geom?.h ?? 0) / 2 },
  }
  const k = clamp01(t)
  const lx = seg.from.x + (seg.to.x - seg.from.x) * k
  const ly = seg.from.y + (seg.to.y - seg.from.y) * k
  const r = rotate(lx, ly, host.rotation)
  return { x: host.x + r.x, y: host.y + r.y }
}
