import './ladder-rungs.css'
import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import type {
  LadderIR,
  LadderRungIR,
  ContactNetwork,
  RungOutput,
  ContactElement,
  ComparatorElement,
} from '../../transformer/ladder-ir/ladder-ir-types'

/**
 * LadderRungView — renders the Ladder IR as SemaPLC-design rung cards.
 *
 * Each rung becomes a card: a head (number badge + comment) and an inline SVG
 * with left/right power rails, contacts [ ] / [/], coils ( ), and TON/CTU-style
 * blocks. The conducting path (and energized elements) are coloured green using
 * a live-value lookup derived from the plc store; only when status==='RUNNING'.
 *
 * Variable matching mirrors apply-live-values: case-insensitive, FB ports as
 * `instance.port` (e.g. `pushtimer.q`, `cnt.cv`).
 */

const HOT = 'var(--ok)'
const COLD = '#b9bfca'
const RAIL = '#5b6373'

// ── Live lookup ────────────────────────────────────────────────────────────

export type LiveLookup = {
  has: (name: string) => boolean
  get: (name: string) => number | boolean | string | undefined
}

export function makeLookup(values: Record<string, { value: number | boolean | string }>): LiveLookup {
  const lower: Record<string, number | boolean | string> = {}
  for (const k of Object.keys(values)) lower[k.toLowerCase()] = values[k].value
  return {
    has: (name) => Object.prototype.hasOwnProperty.call(lower, name.toLowerCase()),
    get: (name) => lower[name.toLowerCase()],
  }
}

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === '1' || v.toUpperCase() === 'TRUE'
  return false
}

function parseOperand(op: string, lk: LiveLookup): number | boolean | string | undefined {
  if (/^-?\d+(\.\d+)?$/.test(op)) return Number(op)
  const u = op.toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  return lk.has(op) ? lk.get(op) : undefined
}

function compare(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case 'EQ': return a === b
    case 'NE': return a !== b
    case 'GT': return (a as number) > (b as number)
    case 'GE': return (a as number) >= (b as number)
    case 'LT': return (a as number) < (b as number)
    case 'LE': return (a as number) <= (b as number)
    default: return false
  }
}

/** Does a single contact "pass" (conduct), considering NO/NC polarity? */
function contactPasses(c: ContactElement, lk: LiveLookup): boolean {
  const live = lk.has(c.variable) ? truthy(lk.get(c.variable)) : false
  // NC / N conduct when the variable is false; NO / P conduct when true.
  return c.contactType === 'NC' || c.contactType === 'N' ? !live : live
}

function comparatorPasses(c: ComparatorElement, lk: LiveLookup): boolean {
  if (!lk.has(c.leftOperand)) return false
  const left = lk.get(c.leftOperand)
  const right = parseOperand(c.rightOperand, lk)
  if (right === undefined) return false
  return compare(c.operator, left, right)
}

/** Whether a (sub)network conducts end-to-end given the live lookup. */
function networkConducts(net: ContactNetwork, lk: LiveLookup): boolean {
  switch (net.type) {
    case 'true': return true
    case 'contact': return contactPasses(net, lk)
    case 'comparator': return comparatorPasses(net, lk)
    case 'series': return net.elements.every((e) => networkConducts(e, lk))
    case 'parallel': return net.branches.some((b) => networkConducts(b, lk))
    default: return false
  }
}

// ── SVG primitives ───────────────────────────────────────────────────────────

let keySeq = 0
const nk = () => `k${keySeq++}`

function wire(x1: number, y: number, x2: number, on: boolean) {
  return (
    <line
      key={nk()}
      x1={x1} y1={y} x2={x2} y2={y}
      stroke={on ? HOT : COLD}
      strokeWidth={on ? 2.6 : 1.8}
    />
  )
}

/** A contact glyph. `pin` = power arriving at its left terminal. */
function contactGlyph(c: ContactElement, x: number, cy: number, pin: boolean, lk: LiveLookup) {
  const passes = contactPasses(c, lk)
  const hot = pin && passes
  const col = hot ? HOT : COLD
  const hw = 9
  const nc = c.contactType === 'NC' || c.contactType === 'N'
  return (
    <g key={nk()}>
      {wire(x - 24, cy, x - hw, pin)}
      {wire(x + hw, cy, x + 24, hot)}
      <line x1={x - hw} y1={cy - 13} x2={x - hw} y2={cy + 13} stroke={col} strokeWidth="2.4" />
      <line x1={x + hw} y1={cy - 13} x2={x + hw} y2={cy + 13} stroke={col} strokeWidth="2.4" />
      {nc && <line x1={x - hw - 1} y1={cy + 13} x2={x + hw + 1} y2={cy - 13} stroke={col} strokeWidth="2.2" />}
      <text x={x} y={cy - 20} textAnchor="middle" className="ld-name">{c.variable}</text>
    </g>
  )
}

const CMP_OP_SYM: Record<string, string> = { EQ: '=', NE: '<>', GT: '>', GE: '>=', LT: '<', LE: '<=' }

function cmpLabel(c: ComparatorElement): string {
  return `${c.leftOperand} ${CMP_OP_SYM[c.operator] ?? c.operator} ${c.rightOperand}`
}

/** Half-width of the comparator box, sized to fit its label.
 *  ponytail: 6.6px/char estimate for 11px mono (.ld-name), not real text measuring. */
function cmpHalfW(c: ComparatorElement): number {
  return Math.max(39, Math.ceil((cmpLabel(c).length * 6.6) / 2) + 10)
}

function comparatorGlyph(c: ComparatorElement, x: number, cy: number, pin: boolean, lk: LiveLookup) {
  const passes = comparatorPasses(c, lk)
  const hot = pin && passes
  const col = hot ? HOT : COLD
  const w = cmpHalfW(c) * 2
  const left = x - w / 2
  return (
    <g key={nk()}>
      {wire(left - 24, cy, left, pin)}
      {wire(left + w, cy, left + w + 24, hot)}
      <rect x={left} y={cy - 14} width={w} height={28} rx="5" fill="#fff" stroke={col} strokeWidth={hot ? 2.2 : 1.6} />
      <text x={x} y={cy + 4} textAnchor="middle" className="ld-name">
        {cmpLabel(c)}
      </text>
    </g>
  )
}

function coilGlyph(name: string, coilType: 'standard' | 'set' | 'reset', x: number, cy: number, pin: boolean) {
  const col = pin ? HOT : COLD
  const hw = 11
  const tag = coilType === 'set' ? 'S' : coilType === 'reset' ? 'R' : ''
  return (
    <g key={nk()}>
      {wire(x - 26, cy, x - hw, pin)}
      <path d={`M ${x - hw} ${cy - 13} Q ${x - hw - 7} ${cy} ${x - hw} ${cy + 13}`} fill="none" stroke={col} strokeWidth="2.4" />
      <path d={`M ${x + hw} ${cy - 13} Q ${x + hw + 7} ${cy} ${x + hw} ${cy + 13}`} fill="none" stroke={col} strokeWidth="2.4" />
      {wire(x + hw, cy, x + 26, pin)}
      {tag && <text x={x} y={cy + 4} textAnchor="middle" className="ld-name">{tag}</text>}
      <text x={x} y={cy - 20} textAnchor="middle" className="ld-name">{name}</text>
    </g>
  )
}

function blockGlyph(x: number, cy: number, title: string, rows: string[], pin: boolean, hot: boolean) {
  const w = 86
  const h = 58
  const left = x - w / 2
  const top = cy - h / 2
  const col = hot ? HOT : COLD
  return (
    <g key={nk()}>
      {wire(left - 30, cy, left, pin)}
      {wire(left + w, cy, left + w + 30, hot)}
      <rect x={left} y={top} width={w} height={h} rx="5" fill="#fff" stroke={col} strokeWidth={hot ? 2.2 : 1.6} />
      <rect x={left} y={top} width={w} height="17" rx="5" fill={hot ? 'var(--brand)' : '#8b93a1'} />
      <text x={x} y={top + 12} textAnchor="middle" className="ld-block-title">{title}</text>
      {rows.map((r, i) => (
        <text key={i} x={left + 6} y={top + 31 + i * 13} className="ld-block-row">{r}</text>
      ))}
    </g>
  )
}

// ── Network flattening for layout ────────────────────────────────────────────

type FlatEl =
  | { t: 'contact'; el: ContactElement }
  | { t: 'comparator'; el: ComparatorElement }
  | { t: 'branch'; branches: FlatEl[][] }

/**
 * Flatten a ContactNetwork into a left-to-right series of slots. Each slot is
 * either a single element or a parallel branch group (whose branches are
 * themselves a series of single elements). Nested series get inlined; a branch
 * containing only a 'true' element is dropped to keep the row clean.
 */
function flattenNetwork(net: ContactNetwork): FlatEl[] {
  switch (net.type) {
    case 'true':
      return []
    case 'contact':
      return [{ t: 'contact', el: net }]
    case 'comparator':
      return [{ t: 'comparator', el: net }]
    case 'series':
      return net.elements.flatMap(flattenNetwork)
    case 'parallel': {
      const branches = net.branches.map((b) => flattenNetwork(b))
      return [{ t: 'branch', branches }]
    }
    default:
      return []
  }
}

function branchConducts(row: FlatEl[], lk: LiveLookup): boolean {
  for (const slot of row) {
    if (slot.t === 'contact' && !contactPasses(slot.el, lk)) return false
    if (slot.t === 'comparator' && !comparatorPasses(slot.el, lk)) return false
    if (slot.t === 'branch') {
      if (!slot.branches.some((b) => branchConducts(b, lk))) return false
    }
  }
  return true
}

// ── Output description ───────────────────────────────────────────────────────

type OutputSpec =
  | { t: 'coil'; name: string; coilType: 'standard' | 'set' | 'reset' }
  | { t: 'block'; title: string; rows: string[]; instanceName: string; portQ: string }

function outputSpecs(out: RungOutput, lk: LiveLookup): OutputSpec[] {
  switch (out.type) {
    case 'coil':
      return [{ t: 'coil', name: out.variable, coilType: out.coilType }]
    case 'timer': {
      const et = lk.get(`${out.instanceName}.et`)
      return [{
        t: 'block',
        title: out.timerType,
        rows: ['IN      Q', `PT ${out.presetTime}`, `ET ${et ?? '--'}`],
        instanceName: out.instanceName,
        portQ: `${out.instanceName}.q`,
      }]
    }
    case 'counter': {
      const cv = lk.get(`${out.instanceName}.cv`)
      return [{
        t: 'block',
        title: out.counterType,
        rows: ['CU      Q', `PV ${out.presetValue}`, `CV ${cv ?? '--'}`],
        instanceName: out.instanceName,
        portQ: `${out.instanceName}.q`,
      }]
    }
    case 'multi':
      return out.outputs.flatMap((o) => outputSpecs(o, lk))
    default:
      return []
  }
}

// ── Rung rendering ───────────────────────────────────────────────────────────

const W = 720
const RAIL_L = 22
const RAIL_R = W - 22

function renderRung(rung: LadderRungIR, lk: LiveLookup, live: boolean) {
  const els = flattenNetwork(rung.inputNetwork)
  const outs = outputSpecs(rung.output, lk)
  // For timer/counter outputs the IR drives the block from the timer's own
  // inputNetwork; we already flattened rung.inputNetwork (the coil rung). For
  // blocks, append them as right-side slots after the input contacts.
  const inputCount = els.length
  const slotCount = inputCount + outs.length
  const hasBranch = els.some((e) => e.t === 'branch')
  const H = hasBranch ? 132 : 66
  const cy = hasBranch ? H / 2 : H / 2 + 2

  // X centers across the rung interior.
  const x0 = 100
  const x1 = RAIL_R - 70
  const centers: number[] =
    slotCount <= 1 ? [110] : Array.from({ length: slotCount }, (_, i) => x0 + (x1 - x0) * (i / (slotCount - 1)))

  const nodes: ReactNode[] = []
  let pin = live // left rail is hot only while running

  // Distance from a slot's center to the outer end of its own stub wires.
  const reach = (s: FlatEl): number => {
    if (s.t === 'comparator') return cmpHalfW(s.el) + 24
    if (s.t === 'branch') return 40 + s.branches.flat().reduce((m, b) => Math.max(m, b.t === 'comparator' ? cmpHalfW(b.el) - 39 : 0), 0)
    return 24
  }

  // Input contacts / branches
  let prevReach = 0
  els.forEach((slot, i) => {
    const from = i === 0 ? RAIL_L : centers[i - 1] + prevReach
    // keep wide boxes clear of the rail / previous slot
    const x = Math.max(centers[i], from + reach(slot) + 4)
    centers[i] = x
    if (slot.t === 'branch') {
      const bw = reach(slot) // vertical bars sit at x ± bw
      let anyOut = false
      const rowH = 56
      slot.branches.forEach((row, ri) => {
        const ry = cy + (ri - (slot.branches.length - 1) / 2) * rowH
        const rout = pin && branchConducts(row, lk)
        // wires first, glyphs after — comparator boxes repaint over them
        nodes.push(<line key={nk()} x1={x - bw} y1={cy} x2={x - bw} y2={ry} stroke={pin ? HOT : COLD} strokeWidth={pin ? 2.4 : 1.6} />)
        nodes.push(<line key={nk()} x1={x + bw} y1={ry} x2={x + bw} y2={cy} stroke={rout ? HOT : COLD} strokeWidth={rout ? 2.4 : 1.6} />)
        nodes.push(wire(x - bw, ry, x - 24, pin))
        nodes.push(wire(x + 24, ry, x + bw, rout))
        let rp = pin
        // single-element branch rows (common case)
        row.forEach((b) => {
          if (b.t === 'contact') {
            nodes.push(contactGlyph(b.el, x, ry, rp, lk))
            rp = rp && contactPasses(b.el, lk)
          } else if (b.t === 'comparator') {
            nodes.push(comparatorGlyph(b.el, x, ry, rp, lk))
            rp = rp && comparatorPasses(b.el, lk)
          }
        })
        if (rp) anyOut = true
      })
      nodes.push(wire(from, cy, x - bw, pin))
      pin = pin && anyOut
      if (i === slotCount - 1) nodes.push(wire(x + bw, cy, RAIL_R, pin))
    } else if (slot.t === 'contact') {
      nodes.push(wire(from, cy, x - 24, pin))
      nodes.push(contactGlyph(slot.el, x, cy, pin, lk))
      pin = pin && contactPasses(slot.el, lk)
    } else {
      // comparator
      nodes.push(wire(from, cy, x - reach(slot), pin))
      nodes.push(comparatorGlyph(slot.el, x, cy, pin, lk))
      pin = pin && comparatorPasses(slot.el, lk)
    }
    prevReach = reach(slot)
  })

  // Outputs (coils / blocks)
  outs.forEach((o, j) => {
    const i = inputCount + j
    const x = centers[i]
    const from = i === 0 ? RAIL_L : centers[i - 1] + prevReach
    if (o.t === 'coil') {
      nodes.push(wire(from, cy, x - 26, pin))
      nodes.push(coilGlyph(o.name, o.coilType, x, cy, pin))
      nodes.push(wire(x + 26, cy, RAIL_R, pin))
      prevReach = 26
    } else {
      const hot = pin && (lk.has(o.portQ) ? truthy(lk.get(o.portQ)) : false)
      nodes.push(wire(from, cy, x - 43 - 30, pin))
      nodes.push(blockGlyph(x, cy, o.title, o.rows, pin, hot))
      nodes.push(wire(x + 43 + 30, cy, RAIL_R, hot))
      prevReach = 43 + 30
    }
  })

  return (
    <div className="ld-rung" key={rung.id}>
      <div className="ld-rung-head">
        <span className="ld-rung-n">{String(rung.index + 1).padStart(2, '0')}</span>
        {rung.comment ?? networkLabel(rung)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ld-svg" preserveAspectRatio="xMidYMid meet">
        <line x1={RAIL_L} y1="6" x2={RAIL_L} y2={H - 6} stroke={RAIL} strokeWidth="3" />
        <line x1={RAIL_R} y1="6" x2={RAIL_R} y2={H - 6} stroke={RAIL} strokeWidth="3" />
        {nodes}
      </svg>
    </div>
  )
}

/** A short human label for a rung when it has no comment. */
function networkLabel(rung: LadderRungIR): string {
  const out = rung.output
  if (out.type === 'coil') return out.variable
  if (out.type === 'timer') return `${out.instanceName} (${out.timerType})`
  if (out.type === 'counter') return `${out.instanceName} (${out.counterType})`
  return rung.id
}

// ── Top-level view ─────────────────────────────────────────────────────────

export function LadderRungView({
  ir,
  values,
  running,
}: {
  ir: LadderIR
  values: Record<string, { value: number | boolean | string }>
  running: boolean
}) {
  const t = useT()
  const lk = makeLookup(running ? values : {})
  keySeq = 0
  return (
    <div className="ladder-view">
      <div className="logic-head">
        {t('ladder.head.title')} · {t('ladder.head.rungCount', { count: ir.rungs.length })} · {running ? t('ladder.head.liveHighlight') : t('ladder.head.notRunning')}
      </div>
      <div className="ld-rungs">
        {ir.rungs.map((rung) => renderRung(rung, lk, running))}
      </div>
    </div>
  )
}
