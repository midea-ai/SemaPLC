/**
 * Live-value overlay for the ladder diagram.
 *
 * Takes the static nodes produced by the ST→ladder transformer and a snapshot of
 * runtime variable values (from plc:values), and returns a new node array with a
 * `data.live` overlay on every node whose variable resolves. Pure and synchronous
 * so it can run on every 500ms value tick and be unit-tested without React.
 *
 * Name matching is case-insensitive: ladder names come from the ST AST (e.g.
 * `timer.Q`, `red_led`) while runtime keys are lowercased (`timer.q`, `red_led`).
 */

import type { LadderNode, LadderNodeData, LiveNodeState } from '../../models/ladder-elements'

type ValueMap = Record<string, { value: number | boolean | string }>

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') return v === '1' || v.toUpperCase() === 'TRUE'
  return false
}

type Lookup = {
  has: (name: string) => boolean
  get: (name: string) => number | boolean | string | undefined
}

function parseOperand(op: string, lk: Lookup): number | boolean | string | undefined {
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

function computeLive(data: LadderNodeData, lk: Lookup): LiveNodeState | null {
  switch (data.elementType) {
    case 'contact': {
      if (!lk.has(data.variable)) return null
      const v = lk.get(data.variable)
      const b = truthy(v)
      return { active: data.negated ? !b : b, value: v }
    }
    case 'coil': {
      if (!lk.has(data.variable)) return null
      const v = lk.get(data.variable)
      return { active: truthy(v), value: v }
    }
    case 'timer': {
      const q = `${data.instanceName}.q`
      const et = `${data.instanceName}.et`
      if (!lk.has(q) && !lk.has(et)) return null
      return { active: truthy(lk.get(q)), value: lk.get(et) }
    }
    case 'counter': {
      const cv = `${data.instanceName}.cv`
      const q = `${data.instanceName}.q`
      const qu = `${data.instanceName}.qu`
      if (!lk.has(cv) && !lk.has(q) && !lk.has(qu)) return null
      const out = lk.has(q) ? lk.get(q) : lk.get(qu)
      return { active: truthy(out), value: lk.get(cv) }
    }
    case 'comparator': {
      if (!lk.has(data.leftOperand)) return null
      const left = lk.get(data.leftOperand)
      const right = parseOperand(data.rightOperand, lk)
      if (right === undefined) return null
      return { active: compare(data.operator, left, right), value: left }
    }
    default:
      return null
  }
}

export function applyLiveValues(nodes: LadderNode[], values: ValueMap): LadderNode[] {
  const lower: Record<string, number | boolean | string> = {}
  for (const k of Object.keys(values)) lower[k.toLowerCase()] = values[k].value
  const lk: Lookup = {
    has: (name) => Object.prototype.hasOwnProperty.call(lower, name.toLowerCase()),
    get: (name) => lower[name.toLowerCase()],
  }

  return nodes.map((nodeItem) => {
    const live = computeLive(nodeItem.data, lk)
    if (live) {
      return { ...nodeItem, data: { ...nodeItem.data, live } }
    }
    // Clear any stale overlay so coloring disappears when the PLC stops.
    if (nodeItem.data.live) {
      const { live: _omit, ...rest } = nodeItem.data
      return { ...nodeItem, data: rest as LadderNodeData }
    }
    return nodeItem
  })
}
