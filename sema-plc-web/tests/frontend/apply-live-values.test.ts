import { describe, it, expect } from 'vitest'
import { applyLiveValues } from '../../src/transformer/live/apply-live-values'
import type { LadderNode } from '../../src/models/ladder-elements'

// Minimal node factory — only the data fields the overlay reads matter.
function node(id: string, data: Record<string, unknown>): LadderNode {
  return { id, type: data.elementType as string, position: { x: 0, y: 0 }, data: { id, rungIndex: 0, columnIndex: 0, ...data } } as LadderNode
}

const val = (value: number | boolean | string) => ({ value, type: '', index: 0, location: '' })

describe('applyLiveValues', () => {
  it('energizes a NO contact when its variable is TRUE', () => {
    const nodes = [node('c1', { elementType: 'contact', variable: 'hb_out', contactType: 'NO', negated: false })]
    const out = applyLiveValues(nodes, { hb_out: val(true) })
    expect(out[0].data.live).toEqual({ active: true, value: true })
  })

  it('does NOT energize a NO contact when its variable is FALSE', () => {
    const nodes = [node('c1', { elementType: 'contact', variable: 'hb_out', contactType: 'NO', negated: false })]
    const out = applyLiveValues(nodes, { hb_out: val(false) })
    expect(out[0].data.live?.active).toBe(false)
  })

  it('inverts conduction for a negated (NC) contact', () => {
    const nodes = [node('c1', { elementType: 'contact', variable: 'x', contactType: 'NC', negated: true })]
    const out = applyLiveValues(nodes, { x: val(false) })
    expect(out[0].data.live?.active).toBe(true)
  })

  it('leaves a node with no resolved value un-overlaid (live undefined)', () => {
    const nodes = [node('c1', { elementType: 'contact', variable: 'missing', contactType: 'NO', negated: false })]
    const out = applyLiveValues(nodes, {})
    expect(out[0].data.live).toBeUndefined()
  })

  it('clears a stale live overlay when the value disappears', () => {
    const stale = node('c1', { elementType: 'contact', variable: 'x', contactType: 'NO', negated: false, live: { active: true, value: true } })
    const out = applyLiveValues([stale], {})
    expect(out[0].data.live).toBeUndefined()
  })

  it('energizes a coil from its variable', () => {
    const nodes = [node('k1', { elementType: 'coil', variable: 'red_led', coilType: 'standard' })]
    expect(applyLiveValues(nodes, { red_led: val(true) })[0].data.live).toEqual({ active: true, value: true })
  })

  it('matches FB ports case-insensitively (ladder timer.Q ↔ runtime timer.q) and shows ET', () => {
    const nodes = [node('t1', { elementType: 'timer', instanceName: 'timer', timerType: 'TON', presetTime: 'T#1s' })]
    const out = applyLiveValues(nodes, { 'timer.q': val(true), 'timer.et': val(500) })
    expect(out[0].data.live).toEqual({ active: true, value: 500 })
  })

  it('shows counter CV as value and energizes from its Q output', () => {
    const nodes = [node('n1', { elementType: 'counter', instanceName: 'counter', counterType: 'CTU', presetValue: 1000 })]
    const out = applyLiveValues(nodes, { 'counter.cv': val(7), 'counter.q': val(false) })
    expect(out[0].data.live).toEqual({ active: false, value: 7 })
  })

  it('evaluates a comparator against a numeric literal (state = 1)', () => {
    const cmp = (right: string) => node('cmp', { elementType: 'comparator', operator: 'EQ', leftOperand: 'state', rightOperand: right })
    expect(applyLiveValues([cmp('1')], { state: val(1) })[0].data.live?.active).toBe(true)
    expect(applyLiveValues([cmp('0')], { state: val(1) })[0].data.live?.active).toBe(false)
  })

  it('evaluates >= comparators numerically', () => {
    const nodes = [node('cmp', { elementType: 'comparator', operator: 'GE', leftOperand: 'tick_cnt', rightOperand: '30' })]
    expect(applyLiveValues(nodes, { tick_cnt: val(30) })[0].data.live?.active).toBe(true)
    expect(applyLiveValues(nodes, { tick_cnt: val(29) })[0].data.live?.active).toBe(false)
  })

  it('does not mutate the input nodes', () => {
    const nodes = [node('c1', { elementType: 'contact', variable: 'x', contactType: 'NO', negated: false })]
    applyLiveValues(nodes, { x: val(true) })
    expect(nodes[0].data.live).toBeUndefined()
  })
})
