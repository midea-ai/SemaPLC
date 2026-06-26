import type { DetectedIO } from '../types.js'
import type { SceneSpec, PartInstance, Effect } from './sceneSpec.js'
import { PART_BOXES, REQUIRES_MANUAL_LAYOUT } from './partsCatalog.js'

// Native part kinds (the SimRuntime parts library). Keep in sync with
// plc-vis-web/src/components/sim/parts.tsx PART_REGISTRY keys.
// stack-light is not in this union — it requiresManualLayout and is never auto-placed.
type Kind = 'lamp' | 'conveyor' | 'cylinder' | 'tank' | 'motor' | 'valve' | 'numeric-display' | 'sensor-button'
          | 'gauge' | 'pump' | 'hopper' | 'slider'

const BOOL_FILL: Effect = { type: 'fill', map: [
  { when: { eq: false }, color: '#9aa1ad' },
  { when: { eq: true }, color: '#22c55e' },
] }
const RUN_CLASS: Effect = { type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] }

const has = (s: string, re: RegExp) => re.test(s.toLowerCase())

// Choose a native part for an IO point from name/type heuristics, mapping to the
// native parts library + a sensible default binding.
function chooseKind(io: DetectedIO): Kind {
  const c = io.component?.toLowerCase()
  if (c) {
    const map: Record<string, Kind> = {
      conveyor: 'conveyor', motor: 'motor', cylinder: 'cylinder', pusher: 'cylinder',
      valve: 'valve', lamp: 'lamp', counter: 'numeric-display', display: 'numeric-display',
      tank: 'tank', gauge: 'gauge', button: 'sensor-button', sensor: 'sensor-button',
      pump: 'pump', hopper: 'hopper',
    }
    if (map[c]) return map[c]
  }
  const n = io.name
  const isBool = io.type.toUpperCase() === 'BOOL'
  // BOOL input → clickable sensor/button. Numeric input → a sensor reading: a gauge
  // (or tank for level-like names), NOT a BOOL button (a sensor-button can't show an
  // analog value, and an %IW INT bound to a fill effect is meaningless).
  if (io.direction === 'input') {
    if (isBool) return 'sensor-button'
    // An adjustable analog setpoint/command (sp/setpoint/ref/manual…) → a draggable
    // slider (force-writes the %IW value). A plain sensor reading → a read-only gauge.
    if (has(n, /(^|_)(sp|set|setpoint|ref|target|cmd|manual|demand)(_|$)/)) return 'slider'
    if (has(n, /level|height|tank/)) return 'tank'
    return 'gauge'
  }
  if (isBool) {
    // Shape-specific names FIRST — the lamp regex contains color words (red/green/
    // yellow) that otherwise greedily mis-catch a colored mechanism like "pusher_red"
    // (→ should be cylinder, not lamp). Colors only mean "lamp" when nothing more
    // specific matches (e.g. "green_light").
    if (has(n, /cyl|push|extend|piston/)) return 'cylinder'
    if (has(n, /valve/)) return 'valve'
    if (has(n, /pump/)) return 'pump'
    if (has(n, /conv|belt/)) return 'conveyor'       // conveyor/belt (incl. conv_motor) → belt
    if (has(n, /motor|spin|rotat/)) return 'motor'   // a bare motor → motor part (was wrongly 'conveyor')
    if (has(n, /lamp|light|led|red|green|yellow|amber/)) return 'lamp'
    return 'lamp'
  }
  if (has(n, /level|temp|press|flow|height|tank/)) return 'tank'
  return 'numeric-display'
}

function defaultBindingEffect(kind: Kind): Effect {
  switch (kind) {
    case 'conveyor':
    case 'motor':
    case 'pump': return RUN_CLASS
    case 'numeric-display': return { type: 'text', format: '{v}' }
    case 'tank':
    case 'hopper': return { type: 'height', valueFrom: 0, valueTo: 100, from: 0, to: 56 }
    case 'gauge': return { type: 'rotate', degPerUnit: 1.8 }
    case 'slider': return { type: 'translateX', valueFrom: 0, valueTo: 100, from: 0, to: 126 }  // thumb over 126px track
    default: return BOOL_FILL   // lamp / cylinder / valve / sensor-button
  }
}

/**
 * Deterministic fallback scene from detected IO — the bootstrap the agent can
 * use as-is or refine. Inputs in a left column, outputs to the right. Memory
 * variables (no Modbus mapping) are skipped. Always passes validateSceneSpec.
 */
export function suggestScene(io: DetectedIO[]): SceneSpec {
  // Relaxed filter (design B6): keep Modbus-mapped IO AND memory BOOLs (internal
  // sensors/flags with %M location) so they still surface as parts.
  const mapped = io.filter(e => e.modbusType != null || (e.direction === 'memory' && e.type.toUpperCase() === 'BOOL'))
  const inputs = mapped.filter(e => e.direction === 'input')
  const outputs = mapped.filter(e => e.direction !== 'input')
  const COL = 170, PAD = 24
  const maxBoxH = Math.max(...Object.values(PART_BOXES).map((b) => b.h))
  const ROW = Math.max(96, maxBoxH + 8)   // design §5: max(96, maxBoxH+8)
  const parts: PartInstance[] = []
  const place = (e: DetectedIO, col: number, row: number) => {
    let kind = chooseKind(e)
    if (REQUIRES_MANUAL_LAYOUT.has(kind)) kind = 'lamp'   // never auto-place multi-binding parts
    const part: PartInstance = {
      id: `W_${e.name}`,
      kind,
      x: PAD + col * COL,
      y: PAD + row * ROW,
      label: e.name,
      bindings: [{ variable: e.name, effect: defaultBindingEffect(kind) }],
    }
    // slider carries {min,max,step}; its thumb (primary) is driven by translateX over
    // the 126px track, and a second binding shows the value as text on data-anchor=val.
    if (kind === 'slider') {
      part.params = { min: 0, max: 100, step: 1 }
      part.bindings.push({ variable: e.name, target: 'val', effect: { type: 'text', format: '{v}' } })
    }
    parts.push(part)
  }
  inputs.forEach((e, i) => place(e, 0, i))
  outputs.forEach((e, i) => place(e, 1, i))
  const rows = Math.max(inputs.length, outputs.length, 1)

  // ── v2 enhancements (snap + translateAlong) ──────────────────────────────
  // If there is a conveyor part, snap BOOL sensors onto it, and put a flowing
  // workpiece on it driven by the first INT "material position" output variable.
  let usedV2 = false
  const conveyor = parts.find(p => p.kind === 'conveyor')
  if (conveyor) {
    for (const p of parts) {
      if (p.kind === 'sensor-button' && !p.snap) {
        p.snap = { to: conveyor.id, dx: 30, dy: -28 }   // above the belt face
        usedV2 = true
      }
    }
    const intVar = mapped.find(e => e.type.toUpperCase() === 'INT' && e.direction !== 'input')
    if (intVar) {
      parts.push({
        // Origin-placed: alongPosition() returns ABSOLUTE scene coords (host.x + offset),
        // applied to the nested #wp element. The part group must be at (0,0) so the
        // conveyor offset isn't double-applied (group transform + absolute alongPosition).
        id: `W_flow_${intVar.name}`,
        kind: 'custom',
        x: 0,
        y: 0,
        svg: '<rect id="wp" x="-6" y="-6" width="12" height="12" rx="2" fill="#f59e0b" stroke="#7c2d12"/>',
        bindings: [{
          variable: intVar.name,
          target: 'wp',
          effect: { type: 'translateAlong', host: conveyor.id, axis: 'x', variable: intVar.name, valueFrom: 0, valueTo: 100 },
        }],
      })
      usedV2 = true
    }
  }

  return {
    version: usedV2 ? '2' : '1',
    canvas: { width: PAD * 2 + COL * 2, height: PAD * 2 + rows * ROW },
    parts,
  }
}
