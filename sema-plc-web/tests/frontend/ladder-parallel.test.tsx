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

// 触点标签在 glyph 上方居中绘制,可远宽于 glyph 本身(18px)。measure() 必须按标签取宽,
// 否则一串长名触点串联时标签会连成一片(比较块早已按 cmpHalfW 这么做了)。
describe('contact slots sized by their name label', () => {
  const vbWidth = (svg: string): number => {
    const m = svg.match(/viewBox="0 0 ([\d.]+) [\d.]+"/)
    if (!m) throw new Error('no viewBox')
    return parseFloat(m[1])
  }

  it('keeps the default width for short names', () => {
    expect(vbWidth(render('Motor := A AND B AND C AND D;'))).toBe(720)
  })

  it('widens the rung when long names need more room than the glyphs do', () => {
    const long = transformSTToLadderIR(
      `PROGRAM Main\nVAR\n  emergency_stop_latched, safety_chain_healthy, drive_fault_feedback,`
      + ` main_power_present, homing_sequence_done, Motor : BOOL;\nEND_VAR\n`
      + `Motor := emergency_stop_latched AND safety_chain_healthy AND drive_fault_feedback`
      + ` AND main_power_present AND homing_sequence_done;\nEND_PROGRAM`,
    )
    expect(long.errors).toEqual([])
    const svg = renderToStaticMarkup(
      <LadderRungView ir={long.ir as LadderIR} values={{}} running={false} />,
    )
    // 5 个 ~20 字符的名字 ≈ 5×140px,远超 5×66px 的 glyph 自然宽 → 必须扩宽
    expect(vbWidth(svg)).toBeGreaterThan(720)
    // 每个名字仍只画一次(扩宽不该丢件或重画)
    for (const n of ['emergency_stop_latched', 'homing_sequence_done']) {
      expect(svg.split(`>${n}</text>`).length - 1).toBe(1)
    }
  })
})

// 通电导线是 2.6px 粗线,要"亮"才看得清;--ok 同时给文字用(编译成功/TRUE/完成),
// 白底上必须更深。两者共用一个变量时,深绿的通路在梯形图里几乎看不出来。
describe('通电路径配色', () => {
  const svgOf = (running: boolean) =>
    renderToStaticMarkup(
      <LadderRungView ir={ir('IF Start THEN Motor := TRUE; END_IF;')}
        values={{ Start: { value: true } }} running={running} />,
    )

  it('通电时用 --hot(亮绿),不用 --ok', () => {
    const svg = svgOf(true)
    expect(svg).toContain('var(--hot)')
    expect(svg).not.toContain('var(--ok)')
  })

  it('未运行时全走 --cold,不出现通电色', () => {
    const svg = svgOf(false)
    expect(svg).toContain('var(--cold)')
    expect(svg).not.toContain('var(--hot)')
  })
})
