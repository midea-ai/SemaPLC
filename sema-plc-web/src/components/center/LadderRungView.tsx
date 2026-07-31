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
const COLD = 'var(--cold)'
const RAIL = 'var(--rail)'

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

function vline(x: number, y1: number, y2: number, on: boolean) {
  return (
    <line
      key={nk()}
      x1={x} y1={y1} x2={x} y2={y2}
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

/** ponytail: 6.6px/char 估算 11px 等宽字体(.ld-name)的宽度,不做真实文本测量。 */
const labelW = (s: string) => s.length * 6.6

/** Half-width of the comparator box, sized to fit its label. */
function cmpHalfW(c: ComparatorElement): number {
  return Math.max(39, Math.ceil(labelW(cmpLabel(c)) / 2) + 10)
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
      <rect x={left} y={cy - 14} width={w} height={28} rx="4" fill="var(--canvas-bg)" stroke={col} strokeWidth={hot ? 2.2 : 1.6} />
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
      <rect x={left} y={top} width={w} height={h} rx="4" fill="var(--canvas-bg)" stroke={col} strokeWidth={hot ? 2.2 : 1.6} />
      <rect x={left} y={top} width={w} height="17" rx="4" fill={hot ? 'var(--brand)' : 'var(--cold)'} />
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

// ── Measurement ──────────────────────────────────────────────────────────────

const MIN_W = 720
const RAIL_L = 22
const STUB = 24        // stub wire each glyph draws on either side of itself
const ROW_H = 56       // vertical pitch between parallel branch rows
const BRANCH_PAD = 16  // gap between a branch's vertical bars and its slot edge
const COIL_HW = 26
const BLOCK_HW = 43 + 30

type Size = { w: number; h: number }

const LABEL_GAP = 8   // minimum clearance between two neighbouring name labels

/** Natural size of one slot, including the stub wires its glyph draws.
 *  A contact's glyph is only 18px wide but its name label is centred above it and
 *  can be far wider — take whichever binds, so a series of long-named contacts
 *  (`fault_reset_trig.Q` AND `safety_chain` AND …) can't run their labels together. */
function measure(el: FlatEl): Size {
  if (el.t === 'contact') {
    return { w: Math.max(18 + STUB * 2, labelW(el.el.variable) + LABEL_GAP), h: ROW_H }
  }
  if (el.t === 'comparator') return { w: cmpHalfW(el.el) * 2 + STUB * 2, h: ROW_H }
  const rows = el.branches.map(measureRow)
  return {
    w: Math.max(...rows.map((r) => r.w)) + BRANCH_PAD * 2,
    h: rows.reduce((s, r) => s + r.h, 0),
  }
}

/** Natural size of a series of slots. */
function measureRow(row: FlatEl[]): Size {
  if (row.length === 0) return { w: 48, h: ROW_H }
  const ms = row.map(measure)
  return {
    w: ms.reduce((s, m) => s + m.w, 0),
    h: Math.max(...ms.map((m) => m.h)),
  }
}

function outWidth(o: OutputSpec): number {
  return (o.t === 'coil' ? COIL_HW : BLOCK_HW) * 2
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/**
 * Draw a series of slots left-to-right across [x0,x1] at height y, splitting any
 * spare width evenly between them. Returns whether power reaches the right end.
 */
function drawRow(
  row: FlatEl[], x0: number, x1: number, y: number,
  pin: boolean, lk: LiveLookup, nodes: ReactNode[]
): boolean {
  if (row.length === 0) {
    nodes.push(wire(x0, y, x1, pin))
    return pin
  }
  const ms = row.map(measure)
  const natural = ms.reduce((s, m) => s + m.w, 0)
  const slack = Math.max(0, (x1 - x0 - natural) / row.length)

  let cur = x0
  let p = pin
  row.forEach((el, i) => {
    const w = ms[i].w + slack
    p = drawEl(el, cur, cur + w, y, p, lk, nodes)
    cur += w
  })
  if (cur < x1) nodes.push(wire(cur, y, x1, p))
  return p
}

/**
 * Draw one slot centred in [x0,x1]. A branch slot recurses back into drawRow for
 * each of its rows, so nested parallels (and multi-element branch rows) lay out
 * the same way a top-level series does.
 */
function drawEl(
  el: FlatEl, x0: number, x1: number, y: number,
  pin: boolean, lk: LiveLookup, nodes: ReactNode[]
): boolean {
  const cx = (x0 + x1) / 2

  if (el.t === 'contact') {
    const p = pin && contactPasses(el.el, lk)
    nodes.push(wire(x0, y, cx - STUB, pin))
    nodes.push(wire(cx + STUB, y, x1, p))
    nodes.push(contactGlyph(el.el, cx, y, pin, lk))
    return p
  }

  if (el.t === 'comparator') {
    const half = cmpHalfW(el.el)
    const p = pin && comparatorPasses(el.el, lk)
    nodes.push(wire(x0, y, cx - half - STUB, pin))
    nodes.push(wire(cx + half + STUB, y, x1, p))
    nodes.push(comparatorGlyph(el.el, cx, y, pin, lk))
    return p
  }

  // Parallel group: vertical bus bars at bx0/bx1, rows stacked around y.
  const bx0 = x0 + BRANCH_PAD
  const bx1 = x1 - BRANCH_PAD
  const rows = el.branches.map(measureRow)
  const total = rows.reduce((s, r) => s + r.h, 0)
  let top = y - total / 2
  let anyOut = false

  const ys: number[] = []
  el.branches.forEach((branch, i) => {
    const ry = top + rows[i].h / 2
    top += rows[i].h
    ys.push(ry)
    if (drawRow(branch, bx0, bx1, ry, pin, lk, nodes)) anyOut = true
  })

  // Each bus bar is one piece of wire: the left one sits at the incoming
  // potential, the right one lights whole as soon as any branch conducts —
  // never segment-by-segment per row.
  const p = pin && anyOut
  const yTop = Math.min(y, ...ys)
  const yBot = Math.max(y, ...ys)
  nodes.push(vline(bx0, yTop, yBot, pin))
  nodes.push(vline(bx1, yTop, yBot, p))
  nodes.push(wire(x0, y, bx0, pin))
  nodes.push(wire(bx1, y, x1, p))
  return p
}

/** One output: coil or FB block, wired from xFrom out to the right rail. */
function drawOutput(
  o: OutputSpec, xFrom: number, cx: number, railR: number, y: number,
  pin: boolean, lk: LiveLookup, nodes: ReactNode[]
): void {
  if (o.t === 'coil') {
    nodes.push(wire(xFrom, y, cx - COIL_HW, pin))
    nodes.push(coilGlyph(o.name, o.coilType, cx, y, pin))
    nodes.push(wire(cx + COIL_HW, y, railR, pin))
    return
  }
  const hot = pin && (lk.has(o.portQ) ? truthy(lk.get(o.portQ)) : false)
  nodes.push(wire(xFrom, y, cx - BLOCK_HW, pin))
  nodes.push(blockGlyph(cx, y, o.title, o.rows, pin, hot))
  nodes.push(wire(cx + BLOCK_HW, y, railR, hot))
}

/**
 * Outputs sharing one input condition stack vertically off a single bus bar —
 * what a PLC editor draws for `IF Start THEN Motor := TRUE; Lamp := TRUE; END_IF`.
 */
function drawOutputs(
  outs: OutputSpec[], xFrom: number, railR: number, cy: number,
  pin: boolean, lk: LiveLookup, nodes: ReactNode[]
): void {
  const cx = (xFrom + railR) / 2
  if (outs.length === 1) {
    drawOutput(outs[0], xFrom, cx, railR, cy, pin, lk, nodes)
    return
  }
  const top = cy - ((outs.length - 1) * ROW_H) / 2
  nodes.push(vline(xFrom, top, top + (outs.length - 1) * ROW_H, pin))
  outs.forEach((o, i) => {
    drawOutput(o, xFrom, cx, railR, top + i * ROW_H, pin, lk, nodes)
  })
}

// ── Rung rendering ───────────────────────────────────────────────────────────

function renderRung(rung: LadderRungIR, lk: LiveLookup, live: boolean) {
  const els = flattenNetwork(rung.inputNetwork)
  const outs = outputSpecs(rung.output, lk)
  const nodes: ReactNode[] = []

  const inSize = measureRow(els)
  const outW = outs.length > 0 ? Math.max(...outs.map(outWidth)) : 0
  // Widen past the default only when the content genuinely needs it; the SVG
  // scales to fit its panel either way.
  const W = Math.max(MIN_W, RAIL_L * 2 + inSize.w + outW + 40)
  const railR = W - 22
  const H = Math.max(inSize.h, outs.length * ROW_H) + 10
  const cy = H / 2

  const xSplit = Math.max(RAIL_L + 60, railR - outW - 40)
  const pin = drawRow(els, RAIL_L, xSplit, cy, live, lk, nodes)
  drawOutputs(outs, xSplit, railR, cy, pin, lk, nodes)

  return (
    <div className="ld-rung" key={rung.id}>
      <div className="ld-rung-head">
        <span className="ld-rung-n">{String(rung.index + 1).padStart(2, '0')}</span>
        {rung.comment ?? networkLabel(rung)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="ld-svg" preserveAspectRatio="xMidYMid meet">
        <line x1={RAIL_L} y1="6" x2={RAIL_L} y2={H - 6} stroke={RAIL} strokeWidth="3" />
        <line x1={railR} y1="6" x2={railR} y2={H - 6} stroke={RAIL} strokeWidth="3" />
        {nodes}
      </svg>
    </div>
  )
}

/** A short human label for a rung when it has no comment. */
function networkLabel(rung: LadderRungIR): string {
  return outputLabel(rung.output) || rung.id
}

function outputLabel(out: RungOutput): string {
  switch (out.type) {
    case 'coil': return out.variable
    case 'timer': return `${out.instanceName} (${out.timerType})`
    case 'counter': return `${out.instanceName} (${out.counterType})`
    case 'multi': return out.outputs.map(outputLabel).filter(Boolean).join(', ')
    default: return ''
  }
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
