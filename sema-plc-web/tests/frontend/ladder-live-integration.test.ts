import { describe, it, expect } from 'vitest'
import { transformSTToLadder } from '../../src/transformer/st-to-ladder'
import { applyLiveValues } from '../../src/transformer/live/apply-live-values'
import type { LadderNode } from '../../src/models/ladder-elements'

// Verifies the real ST→ladder transformer's node names line up with the runtime
// variable keys (lowercased; FB ports as instance.port) that applyLiveValues expects.
// This is the integration crux of Phase 2 — pure logic, no Docker/runtime needed.

const HEARTBEAT = `PROGRAM heartbeat
  VAR
    hb_out AT %QX0.0 : BOOL;
  END_VAR
  VAR
    timer : TON;
  END_VAR
  timer(IN := NOT timer.Q, PT := T#1s);
  hb_out := timer.Q;
END_PROGRAM`

const val = (value: number | boolean | string) => ({ value, type: '', index: 0, location: '' })

describe('ladder live integration (real transformer)', () => {
  it('energizes the hb_out coil from a runtime value', () => {
    const r = transformSTToLadder(HEARTBEAT)
    expect(r.nodes.length).toBeGreaterThan(0)

    const lit = applyLiveValues(r.nodes as unknown as LadderNode[], { hb_out: val(true), 'timer.q': val(true), 'timer.et': val(500) })
    const coil = lit.find((n) => n.data.elementType === 'coil' && n.data.variable === 'hb_out')
    expect(coil, 'expected a coil node for hb_out').toBeTruthy()
    expect(coil!.data.live?.active).toBe(true)
  })

  it('does not energize the coil when hb_out is false', () => {
    const r = transformSTToLadder(HEARTBEAT)
    const lit = applyLiveValues(r.nodes as unknown as LadderNode[], { hb_out: val(false), 'timer.q': val(false) })
    const coil = lit.find((n) => n.data.elementType === 'coil' && n.data.variable === 'hb_out')
    expect(coil!.data.live?.active).toBe(false)
  })

  it('resolves the TON instance Q/ET via the lowercased instance.port keys', () => {
    const r = transformSTToLadder(HEARTBEAT)
    const timer = r.nodes.find((n) => (n.data as { elementType: string }).elementType === 'timer')
    expect(timer, 'expected a timer node').toBeTruthy()

    const lit = applyLiveValues(r.nodes as unknown as LadderNode[], { 'timer.q': val(true), 'timer.et': val(750) })
    const litTimer = lit.find((n) => n.data.elementType === 'timer')!
    expect(litTimer.data.live?.active).toBe(true)
    expect(litTimer.data.live?.value).toBe(750)
  })

  it('clears all coloring when given an empty value snapshot (PLC stopped)', () => {
    const r = transformSTToLadder(HEARTBEAT)
    const lit = applyLiveValues(r.nodes as unknown as LadderNode[], {})
    expect(lit.every((n) => n.data.live === undefined)).toBe(true)
  })
})
