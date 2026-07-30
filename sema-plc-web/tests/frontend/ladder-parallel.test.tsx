import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformSTToLadderIR } from '../../src/transformer/st-to-ladder'
import { LadderRungView } from '../../src/components/center/LadderRungView'
import type { LadderIR, ContactNetwork } from '../../src/transformer/ladder-ir/ladder-ir-types'

function render(body: string): string {
  return renderToStaticMarkup(<LadderRungView ir={ir(body)} values={{}} running={false} />)
}

/** How often a label is drawn as an SVG text node. */
function labelCount(body: string, label: string): number {
  return render(body).split(`>${label}</text>`).length - 1
}

/** The (x,y) a label's glyph is drawn at — two glyphs must never share one. */
function labelPos(svg: string, label: string): string {
  const m = svg.match(new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)"[^>]*>${label}</text>`))
  if (!m) throw new Error(`label ${label} not drawn`)
  return `${m[1]},${m[2]}`
}

/** Count contacts/comparators reachable in a network — nothing may go missing. */
function countLeaves(net: ContactNetwork): number {
  switch (net.type) {
    case 'contact':
    case 'comparator':
      return 1
    case 'series':
      return net.elements.reduce((s, e) => s + countLeaves(e), 0)
    case 'parallel':
      return net.branches.reduce((s, b) => s + countLeaves(b), 0)
    default:
      return 0
  }
}

function ir(body: string): LadderIR {
  const r = transformSTToLadderIR(`PROGRAM Main\nVAR\n  A, B, C, D, Start, Motor, Lamp, Horn : BOOL;\n  N : INT;\nEND_VAR\n${body}\nEND_PROGRAM`)
  expect(r.errors).toEqual([])
  expect(r.ir).toBeDefined()
  return r.ir as LadderIR
}

describe('input-side parallels', () => {
  it('keeps every contact of a nested parallel', () => {
    // (A OR B) AND C OR D -> parallel[ series[parallel[A,B], C], D ]
    const rung = ir('D := (A OR B) AND C OR D;').rungs[0]
    expect(rung.inputNetwork.type).toBe('parallel')
    expect(countLeaves(rung.inputNetwork)).toBe(4)
  })

  it('keeps multi-element branch rows', () => {
    const rung = ir('Motor := (A AND B) OR C;').rungs[0]
    expect(countLeaves(rung.inputNetwork)).toBe(3)
  })

  it('draws every contact of a nested parallel (none silently dropped)', () => {
    for (const name of ['A', 'B', 'C']) {
      expect(labelCount('Motor := (A OR B) AND C OR D;', name)).toBe(1)
    }
  })

  it('draws every contact of a multi-element branch row, side by side', () => {
    const svg = render('Motor := (A AND B) OR C;')
    for (const name of ['A', 'B', 'C']) {
      expect(labelCount('Motor := (A AND B) OR C;', name)).toBe(1)
    }
    // A and B are series *within* one branch row — same row, distinct columns.
    expect(labelPos(svg, 'A')).not.toBe(labelPos(svg, 'B'))
  })
})

describe('output-side parallels', () => {
  it('merges coils sharing one IF condition into a single rung', () => {
    const rungs = ir('IF Start THEN\n  Motor := TRUE;\n  Lamp := TRUE;\n  Horn := TRUE;\nEND_IF;').rungs
    expect(rungs).toHaveLength(1)
    expect(rungs[0].output.type).toBe('multi')
    const out = rungs[0].output as { type: 'multi'; outputs: Array<{ variable?: string }> }
    expect(out.outputs.map((o) => o.variable)).toEqual(['Motor', 'Lamp', 'Horn'])
  })

  it('does not merge coils under different conditions', () => {
    const rungs = ir('IF Start THEN\n  Motor := TRUE;\nEND_IF;\nIF A THEN\n  Lamp := TRUE;\nEND_IF;').rungs
    expect(rungs).toHaveLength(2)
    expect(rungs.map((r) => r.output.type)).toEqual(['coil', 'coil'])
  })

  it('draws all merged coils in one rung', () => {
    const body = 'IF Start THEN\n  Motor := TRUE;\n  Lamp := TRUE;\n  Horn := TRUE;\nEND_IF;'
    expect(labelCount(body, 'Start')).toBe(1) // condition drawn once, not per coil
    for (const name of ['Motor', 'Lamp', 'Horn']) {
      expect(labelCount(body, name)).toBe(1)
    }
  })

  it('names a merged rung after its coils, not its id', () => {
    const svg = render('IF Start THEN\n  Motor := TRUE;\n  Lamp := TRUE;\nEND_IF;')
    expect(svg).toContain('Motor, Lamp')
    expect(svg).not.toContain('rung_0<')
  })

  it('renumbers rungs contiguously after merging', () => {
    const rungs = ir('IF Start THEN\n  Motor := TRUE;\n  Lamp := TRUE;\nEND_IF;\nHorn := A;').rungs
    expect(rungs.map((r) => r.index)).toEqual([0, 1])
    expect(rungs.map((r) => r.id)).toEqual(['rung_0', 'rung_1'])
  })
})
