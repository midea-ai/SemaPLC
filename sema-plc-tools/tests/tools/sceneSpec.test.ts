import { describe, it, expect } from 'vitest'
import { matchValue, viewBoxOf, svgTargetGeometry, lowerAbsoluteTranslate, sizeCustomSvg } from '../../src/tools/sceneSpec.js'

describe('sizeCustomSvg', () => {
  it('补 width/height = viewBox 宽高(防嵌套 svg 膨胀溢出)', () => {
    const out = sizeCustomSvg('<svg viewBox="0 0 280 440"><rect/></svg>')
    expect(out).toMatch(/width="280"/)
    expect(out).toMatch(/height="440"/)
    expect(out).toMatch(/<rect\/>/)  // 内容不变
  })
  it('已有 width/height 不改', () => {
    const src = '<svg viewBox="0 0 100 100" width="50" height="50"><g/></svg>'
    expect(sizeCustomSvg(src)).toBe(src)
  })
  it('只缺 height 时只补 height', () => {
    const out = sizeCustomSvg('<svg viewBox="0 0 120 60" width="120"><g/></svg>')
    expect(out).toMatch(/height="60"/)
    expect((out.match(/width=/g) || []).length).toBe(1)  // 不重复加 width
  })
  it('无 viewBox 无法推断 → 原样返回', () => {
    const src = '<svg><rect/></svg>'
    expect(sizeCustomSvg(src)).toBe(src)
  })
})

describe('matchValue', () => {
  it('eq matches a boolean value', () => {
    expect(matchValue({ eq: true }, true)).toBe(true)
    expect(matchValue({ eq: true }, false)).toBe(false)
  })
  it('eq matches a numeric value', () => {
    expect(matchValue({ eq: 2 }, 2)).toBe(true)
    expect(matchValue({ eq: 2 }, 3)).toBe(false)
  })
  it('eq:false matches numeric 0 (bool/num coercion)', () => {
    expect(matchValue({ eq: false }, 0)).toBe(true)
    expect(matchValue({ eq: true }, 1)).toBe(true)
  })
  it('gte/lt interval', () => {
    expect(matchValue({ gte: 10 }, 10)).toBe(true)
    expect(matchValue({ gte: 10, lt: 20 }, 19)).toBe(true)
    expect(matchValue({ gte: 10, lt: 20 }, 20)).toBe(false)
  })
  it('truthy', () => {
    expect(matchValue({ truthy: true }, 0)).toBe(false)
    expect(matchValue({ truthy: true }, 5)).toBe(true)
    expect(matchValue({ truthy: true }, true)).toBe(true)
  })
})

import { validateSceneSpec } from '../../src/tools/sceneSpec.js'
import type { SceneSpec } from '../../src/tools/sceneSpec.js'

const GOOD: SceneSpec = {
  version: '1',
  canvas: { width: 400, height: 200 },
  parts: [
    { id: 'p1', kind: 'lamp', x: 10, y: 10, bindings: [
      { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
    ] },
  ],
}

describe('validateSceneSpec', () => {
  it('accepts a well-formed scene whose variables are known', () => {
    const r = validateSceneSpec(GOOD, ['red_led'])
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })
  it('rejects an unknown version', () => {
    const r = validateSceneSpec({ ...GOOD, version: '9' as any }, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/version/)
  })
  it('rejects a binding to an unknown variable', () => {
    const r = validateSceneSpec(GOOD, ['green_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/red_led/)
  })
  it('skips the unknown-variable check when knownVariables is empty', () => {
    expect(validateSceneSpec(GOOD, []).ok).toBe(true)
  })
  it('rejects a custom svg with zero data bindings when the program has bindable IO (static dead-figure)', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{
      id: 'c', kind: 'custom', x: 0, y: 0, svg: '<svg viewBox="0 0 10 10"><circle id="a"/></svg>', bindings: [],
    }] }
    const r = validateSceneSpec(bad, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/无任何数据绑定|no data binding/i)
  })
  it('allows a custom svg with zero bindings when the program has no bindable IO (knownVariables empty)', () => {
    const ok: SceneSpec = { ...GOOD, parts: [{
      id: 'c', kind: 'custom', x: 0, y: 0, svg: '<svg viewBox="0 0 10 10"><circle id="a"/></svg>', bindings: [],
    }] }
    expect(validateSceneSpec(ok, []).ok).toBe(true)
  })
  it('rejects a visible effect that is missing its "when" clause (sticky after string-effect coercion)', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{
      id: 'c', kind: 'custom', x: 0, y: 0, svg: '<svg viewBox="0 0 10 10"><circle id="a"/></svg>',
      bindings: [{ variable: 'red_led', target: 'a', effect: { type: 'visible' } as any }],
    }] }
    const r = validateSceneSpec(bad, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/visible.*when/i)
  })
  // 前端只给库部件画外层 label;custom 是整幅自绘画面,写在 label 上的标题会静默消失
  it('warns that a custom part label is not rendered (title must live inside the svg)', () => {
    const spec: SceneSpec = { ...GOOD, parts: [{
      id: 'c', kind: 'custom', x: 0, y: 0, label: '分拣线',
      svg: '<svg viewBox="0 0 10 10"><circle id="a"/></svg>',
      bindings: [{ variable: 'red_led', target: 'a', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#fff' }] } }],
    }] }
    const r = validateSceneSpec(spec, ['red_led'])
    expect(r.ok).toBe(true)                       // 只是提醒,不阻塞生成
    expect(r.warnings.join(' ')).toMatch(/label.*不会渲染/)
  })
  it('does not warn about label on a library part', () => {
    const spec: SceneSpec = { ...GOOD, parts: [{
      id: 'l', kind: 'lamp', x: 0, y: 0, label: '红灯',
      bindings: [{ variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#fff' }] } }],
    }] }
    const r = validateSceneSpec(spec, ['red_led'])
    expect(r.warnings.join(' ')).not.toMatch(/不会渲染/)
  })
  it('rejects a custom part with no svg', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{ id: 'c', kind: 'custom', x: 0, y: 0, bindings: [] }] }
    const r = validateSceneSpec(bad, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/custom.*svg/i)
  })
  it('rejects a custom binding whose target id is absent from the svg', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{
      id: 'c', kind: 'custom', x: 0, y: 0, svg: '<rect id="box"/>',
      bindings: [{ variable: 'red_led', target: 'missing', effect: { type: 'visible', when: { truthy: true } } }],
    }] }
    const r = validateSceneSpec(bad, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/missing/)
  })
  it('rejects duplicate part ids', () => {
    const bad: SceneSpec = { ...GOOD, parts: [GOOD.parts[0], { ...GOOD.parts[0] }] }
    expect(validateSceneSpec(bad, ['red_led']).ok).toBe(false)
  })
})

describe('validateSceneSpec kind whitelist (opts.partKinds)', () => {
  const KINDS = new Set(['lamp', 'tank'])
  it('rejects a kind not in partKinds and not custom', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{ id: 'p', kind: 'gizmo', x: 0, y: 0, bindings: [] }] }
    const r = validateSceneSpec(bad, [], { partKinds: KINDS })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/gizmo/)
  })
  it('still accepts custom even when partKinds is given', () => {
    const ok: SceneSpec = { ...GOOD, parts: [{ id: 'c', kind: 'custom', x: 0, y: 0, svg: '<rect id="a"/>', bindings: [] }] }
    expect(validateSceneSpec(ok, [], { partKinds: KINDS }).ok).toBe(true)
  })
  it('skips the kind check when partKinds is omitted (backward compatible)', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{ id: 'p', kind: 'gizmo', x: 0, y: 0, bindings: [] }] }
    expect(validateSceneSpec(bad, []).ok).toBe(true) // no opts → no kind error
  })
})

describe('validateSceneSpec warnings + visual checks', () => {
  const BOXES = { lamp: { w: 44, h: 44 }, tank: { w: 52, h: 64 } }
  // 含 on+off 的干净 fill map,不会触发粘色 warning
  const GOOD_CLEAN: SceneSpec = {
    version: '1', canvas: { width: 400, height: 200 },
    parts: [{ id: 'p1', kind: 'lamp', x: 10, y: 10, bindings: [
      { variable: 'red_led', effect: { type: 'fill', map: [
        { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#9aa1ad' }] } }] }],
  }

  it('result now carries a warnings array (empty when clean)', () => {
    const r = validateSceneSpec(GOOD_CLEAN, ['red_led'], { partBoxes: BOXES })
    expect(r.warnings).toEqual([])
  })

  it('errors when a translateX effect is missing valueFrom/from', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{ id: 'p', kind: 'cylinder', x: 0, y: 0, bindings: [
      { variable: 'red_led', effect: { type: 'translateX', valueTo: 1, to: 10 } as any },
    ] }] }
    const r = validateSceneSpec(bad, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/translateX/)
  })

  it('errors when a fill effect has an empty map', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{ id: 'p', kind: 'lamp', x: 0, y: 0, bindings: [
      { variable: 'red_led', effect: { type: 'fill', map: [] } },
    ] }] }
    const r = validateSceneSpec(bad, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/fill.*map|map.*empty/i)
  })

  it('errors when a custom svg is empty or has no "<"', () => {
    const bad: SceneSpec = { ...GOOD, parts: [{ id: 'c', kind: 'custom', x: 0, y: 0, svg: 'plain text', bindings: [] }] }
    expect(validateSceneSpec(bad, []).ok).toBe(false)
  })

  it('custom target check uses a regex (single quotes / spaces tolerated)', () => {
    const ok: SceneSpec = { ...GOOD, parts: [{ id: 'c', kind: 'custom', x: 0, y: 0,
      svg: "<rect id='door' />",
      bindings: [{ variable: 'red_led', target: 'door', effect: { type: 'visible', when: { truthy: true } } }] }] }
    expect(validateSceneSpec(ok, ['red_led']).ok).toBe(true)
  })

  it('warns (not error) when a part box overflows the canvas', () => {
    const sc: SceneSpec = { version: '1', canvas: { width: 50, height: 50 },
      parts: [{ id: 'p', kind: 'tank', x: 40, y: 40, bindings: [
        { variable: 'red_led', effect: { type: 'height', valueFrom: 0, valueTo: 1, from: 0, to: 10 } }] }] }
    const r = validateSceneSpec(sc, ['red_led'], { partBoxes: BOXES })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/overflow|canvas|超出/i)
  })

  it('warns when a custom svg lacks viewBox', () => {
    const sc: SceneSpec = { ...GOOD_CLEAN, parts: [{ id: 'c', kind: 'custom', x: 0, y: 0,
      svg: '<g><rect id="a"/></g>',
      bindings: [{ variable: 'red_led', target: 'a', effect: { type: 'visible', when: { truthy: true } } }] }] }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/viewBox/)
  })

  it('warns when a fill map has no off-state (sticky color)', () => {
    const sc: SceneSpec = { version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'p', kind: 'lamp', x: 0, y: 0, bindings: [
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#0f0' }] } }] }] }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/off|粘色|reset/i)
  })

  it('warns when a stack-light has fewer than 3 bindings', () => {
    const sc: SceneSpec = { version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'sl', kind: 'stack-light', x: 0, y: 0, bindings: [
        { variable: 'red_led', target: 'red', effect: { type: 'fill', map: [
          { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#555' }] } }] }] }
    const r = validateSceneSpec(sc, ['red_led'], { partKinds: new Set(['stack-light']) })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/stack-light|3|报警灯柱/i)
  })

  it('warns when two custom parts share an id (global collision risk)', () => {
    const sc: SceneSpec = { version: '1', canvas: { width: 200, height: 200 }, parts: [
      { id: 'a', kind: 'custom', x: 0, y: 0, svg: '<rect id="box"/>', bindings: [] },
      { id: 'b', kind: 'custom', x: 50, y: 0, svg: '<rect id="box"/>', bindings: [] },
    ] }
    const r = validateSceneSpec(sc, [])
    expect(r.warnings.join(' ')).toMatch(/id.*collision|碰撞|shared id|交集/i)
  })

  it('warns when two parts fully overlap', () => {
    const sc: SceneSpec = { version: '1', canvas: { width: 200, height: 200 }, parts: [
      { id: 'a', kind: 'lamp', x: 10, y: 10, bindings: [] },
      { id: 'b', kind: 'lamp', x: 10, y: 10, bindings: [] },
    ] }
    expect(validateSceneSpec(sc, []).warnings.join(' ')).toMatch(/overlap|重叠/i)
  })

  it('keeps backward compat: two-arg call still returns a warnings array', () => {
    const r = validateSceneSpec(GOOD_CLEAN, ['red_led'])
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.warnings)).toBe(true)
  })
})

import type { SnapTo, TranslateAlongEffect } from '../../src/tools/sceneSpec.js'

// ── Task 2: v2 validateSceneSpec tests ────────────────────────────────────────

describe('validateSceneSpec version whitelist', () => {
  it('accepts version "2"', () => {
    const v2: SceneSpec = { ...GOOD, version: '2' }
    expect(validateSceneSpec(v2, ['red_led']).ok).toBe(true)
  })
})

const V2_BASE: SceneSpec = {
  version: '2', canvas: { width: 300, height: 120 },
  parts: [
    { id: 'belt', kind: 'conveyor', x: 0, y: 40, bindings: [] },
    { id: 'box', kind: 'custom', x: 0, y: 0, svg: '<rect id="b" width="10" height="10"/>',
      snap: { to: 'belt', dx: 20, dy: -6 }, bindings: [] },
  ],
}

describe('validateSceneSpec v2', () => {
  it('accepts a valid snap pointing at an existing part', () => {
    expect(validateSceneSpec(V2_BASE, []).ok).toBe(true)
  })
  it('rejects snap.to pointing at a missing part', () => {
    const bad: SceneSpec = JSON.parse(JSON.stringify(V2_BASE))
    bad.parts[1].snap!.to = 'nope'
    const r = validateSceneSpec(bad, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/snap.*nope|nope.*snap|not found/i)
  })
  it('rejects a self-referential snap', () => {
    const bad: SceneSpec = JSON.parse(JSON.stringify(V2_BASE))
    bad.parts[1].snap!.to = 'box'
    const r = validateSceneSpec(bad, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/self|itself|cycle|环/i)
  })
  it('rejects a snap cycle (a→b→a)', () => {
    const bad: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [
        { id: 'a', kind: 'lamp', x: 0, y: 0, snap: { to: 'b', dx: 0, dy: 0 }, bindings: [] },
        { id: 'b', kind: 'lamp', x: 0, y: 0, snap: { to: 'a', dx: 0, dy: 0 }, bindings: [] },
      ],
    }
    const r = validateSceneSpec(bad, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/cycle|环/i)
  })
  it('rejects a translateAlong whose host is missing', () => {
    const eff: TranslateAlongEffect = { type: 'translateAlong', host: 'ghost', variable: 'pos', valueFrom: 0, valueTo: 100 }
    const bad: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [{ id: 'belt', kind: 'conveyor', x: 0, y: 0, bindings: [{ variable: 'pos', effect: eff }] }],
    }
    const r = validateSceneSpec(bad, ['pos'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/host.*ghost|ghost/i)
  })
  it('rejects translateAlong with valueFrom >= valueTo', () => {
    const eff: TranslateAlongEffect = { type: 'translateAlong', host: 'belt', variable: 'pos', valueFrom: 100, valueTo: 100 }
    const bad: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [{ id: 'belt', kind: 'conveyor', x: 0, y: 0, bindings: [{ variable: 'pos', effect: eff }] }],
    }
    const r = validateSceneSpec(bad, ['pos'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/valueFrom.*valueTo|range/i)
  })
  it('warns (does not reject) when an unknown variable drives translateAlong', () => {
    const eff: TranslateAlongEffect = { type: 'translateAlong', host: 'belt', variable: 'internal_pos', valueFrom: 0, valueTo: 100 }
    const scene: SceneSpec = {
      version: '2', canvas: { width: 100, height: 100 },
      parts: [{ id: 'belt', kind: 'conveyor', x: 0, y: 0, bindings: [{ variable: 'internal_pos', effect: eff }] }],
    }
    const r = validateSceneSpec(scene, ['other_io'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/internal_pos/)
  })
  it('warns when a v1 scene contains v2 fields', () => {
    const v1WithSnap: SceneSpec = { ...V2_BASE, version: '1' }
    const r = validateSceneSpec(v1WithSnap, [])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/version.*2|snap|translateAlong/i)
  })

  // Rule 2 (hard rule): translateAlong.host pointing at a custom part (no motion
  // axis) silently no-ops. This is the bug we just hit — self-check must catch it.
  it('warns when translateAlong.host points at a custom part (no motion axis)', () => {
    const eff: TranslateAlongEffect = { type: 'translateAlong', host: 'belt_custom', variable: 'pos', valueFrom: 0, valueTo: 100 }
    const scene: SceneSpec = {
      version: '2', canvas: { width: 400, height: 200 },
      parts: [
        { id: 'belt_custom', kind: 'custom', x: 10, y: 10, svg: '<svg viewBox="0 0 120 54"><rect id="b" width="120" height="54"/></svg>', bindings: [] },
        { id: 'wp', kind: 'custom', x: 200, y: 100, svg: '<svg viewBox="0 0 12 12"><rect id="wp-rect" width="12" height="12"/></svg>',
          bindings: [{ variable: 'pos', target: 'wp-rect', effect: eff }] },
      ],
    }
    const r = validateSceneSpec(scene, ['pos'])
    // The rule-2 warning specifically: host is a custom part with no motion axis.
    expect(r.warnings.join(' ')).toMatch(/无运动轴|custom 部件|translateX 局部平移|won.?t take effect/i)
    expect(r.warnings.join(' ')).toMatch(/belt_custom/)
  })

  it('does NOT warn when translateAlong.host points at a conveyor library part', () => {
    const eff: TranslateAlongEffect = { type: 'translateAlong', host: 'belt', variable: 'pos', valueFrom: 0, valueTo: 100 }
    const scene: SceneSpec = {
      version: '2', canvas: { width: 400, height: 200 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 10, y: 10, bindings: [] },
        { id: 'wp', kind: 'custom', x: 200, y: 100, svg: '<svg viewBox="0 0 12 12"><rect id="wp-rect" width="12" height="12"/></svg>',
          bindings: [{ variable: 'pos', target: 'wp-rect', effect: eff }] },
      ],
    }
    const r = validateSceneSpec(scene, ['pos'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).not.toMatch(/无运动轴|custom 部件|no motion axis/i)
  })
})

describe('translateY effect', () => {
  it('accepts a valid translateY effect', () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 300 },
      parts: [{ id: 'cab', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 400 300"><rect id="cab_body" width="40" height="30"/></svg>',
        bindings: [{ variable: 'cab_pos', target: 'cab_body',
          effect: { type: 'translateY', valueFrom: 0, valueTo: 100, from: 0, to: 250 } }] }],
    }
    const r = validateSceneSpec(scene, ['cab_pos'])
    expect(r.ok).toBe(true)
    expect(r.errors).toHaveLength(0)
  })

  it('rejects translateY missing numeric fields', () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 300 },
      parts: [{ id: 'cab', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 400 300"><rect id="cab_body" width="40" height="30"/></svg>',
        bindings: [{ variable: 'cab_pos', target: 'cab_body',
          effect: { type: 'translateY', valueFrom: 0, valueTo: 100 } as any }] }],
    }
    const r = validateSceneSpec(scene, ['cab_pos'])
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => e.includes('from') || e.includes('to'))).toBe(true)
  })
})

describe('opacity effect', () => {
  it('accepts a valid opacity effect', () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 300 },
      parts: [{ id: 'flow', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 400 300"><line id="flow_pipe" x1="0" y1="0" x2="100" y2="0"/></svg>',
        bindings: [{ variable: 'valve_pos', target: 'flow_pipe',
          effect: { type: 'opacity', valueFrom: 0, valueTo: 100, from: 0.1, to: 1.0 } }] }],
    }
    const r = validateSceneSpec(scene, ['valve_pos'])
    expect(r.ok).toBe(true)
  })
})

describe('SceneSpec v2 types', () => {
  it('a PartInstance accepts a snap field', () => {
    const snap: SnapTo = { to: 'belt', dx: 30, dy: -6 }
    const scene: SceneSpec = {
      version: '2', canvas: { width: 200, height: 100 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 0, y: 40, bindings: [] },
        { id: 'sensor', kind: 'sensor-button', x: 0, y: 0, snap, bindings: [] },
      ],
    }
    expect(scene.parts[1].snap).toEqual({ to: 'belt', dx: 30, dy: -6 })
  })
  it('a Binding accepts a translateAlong effect', () => {
    const eff: TranslateAlongEffect = {
      type: 'translateAlong', host: 'belt', axis: 'x',
      variable: 'pos', valueFrom: 0, valueTo: 100,
    }
    const scene: SceneSpec = {
      version: '2', canvas: { width: 200, height: 100 },
      parts: [{ id: 'belt', kind: 'conveyor', x: 0, y: 40, bindings: [
        { variable: 'pos', effect: eff },
      ] }],
    }
    expect(scene.parts[0].bindings[0].effect.type).toBe('translateAlong')
  })
})

describe('validateSceneSpec unknown part fields', () => {
  it('rejects a part with "effects" instead of "bindings" (bindings absent)', () => {
    const bad: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'p', kind: 'lamp', x: 0, y: 0, bindings: [], effects: [
        { variable: 'x', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] } as any],
    }
    const r = validateSceneSpec(bad, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/effects.*bindings|did you mean/i)
  })

  it('downgrades to warning when "effects" coexists with valid bindings', () => {
    const ok: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'p', kind: 'lamp', x: 0, y: 0,
        bindings: [{ variable: 'red_led', effect: { type: 'fill', map: [
          { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#999' }] } }],
        effects: [{ something: true }],
      } as any],
    }
    const r = validateSceneSpec(ok, ['red_led'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/effects.*ignored|will be ignored/i)
  })

  it('rejects "animation" as a bindings typo (no valid bindings)', () => {
    const bad: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'p', kind: 'lamp', x: 0, y: 0, bindings: [], animation: {} } as any],
    }
    const r = validateSceneSpec(bad, [])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/animation.*bindings|did you mean/i)
  })

  it('warns on a completely unknown field (not a bindings typo)', () => {
    const sc: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'p', kind: 'lamp', x: 0, y: 0,
        bindings: [{ variable: 'red_led', effect: { type: 'fill', map: [
          { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#999' }] } }],
        foo: 'bar',
      } as any],
    }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/foo.*ignored|unknown field.*foo/i)
  })

  it('no warning on a part with only known fields (including optional ones)', () => {
    const sc: SceneSpec = {
      version: '2', canvas: { width: 400, height: 200 },
      parts: [{ id: 'p', kind: 'lamp', x: 10, y: 20, w: 44, h: 44, rotation: 0,
        label: 'test', params: { min: 0 },
        snap: { to: 'other', dx: 0, dy: 0 },
        bindings: [{ variable: 'red_led', effect: { type: 'fill', map: [
          { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#999' }] } }],
      },
      { id: 'other', kind: 'lamp', x: 100, y: 20, bindings: [] }],
    }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.warnings.filter(w => /unknown field/i.test(w))).toEqual([])
  })
})

describe('validateSceneSpec custom target case-sensitivity', () => {
  it('accepts target matching svg id with exact case', () => {
    const sc: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'c', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 40 40"><rect id="MyBtn" width="40" height="40"/></svg>',
        bindings: [{ variable: 'red_led', target: 'MyBtn',
          effect: { type: 'fill', map: [
            { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#999' }] } }],
      }],
    }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.errors.filter(e => /target/i.test(e))).toEqual([])
  })

  it('rejects target with case mismatch against svg id', () => {
    const sc: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'c', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 40 40"><rect id="mybtn" width="40" height="40"/></svg>',
        bindings: [{ variable: 'red_led', target: 'MyBtn',
          effect: { type: 'fill', map: [
            { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#999' }] } }],
      }],
    }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/MyBtn.*not found/i)
  })

  it('handles target with regex special characters safely', () => {
    const sc: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'c', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 40 40"><rect id="btn[0]" width="40" height="40"/></svg>',
        bindings: [{ variable: 'red_led', target: 'btn[0]',
          effect: { type: 'fill', map: [
            { when: { eq: true }, color: '#f00' }, { when: { eq: false }, color: '#999' }] } }],
      }],
    }
    const r = validateSceneSpec(sc, ['red_led'])
    expect(r.errors.filter(e => /target/i.test(e))).toEqual([])
  })
})

describe('viewBoxOf', () => {
  it('parses viewBox', () => {
    expect(viewBoxOf(`<svg viewBox="0 0 200 520"><rect/></svg>`)).toEqual({ x: 0, y: 0, w: 200, h: 520 })
  })
  it('falls back to width/height, else null', () => {
    expect(viewBoxOf(`<svg width="100" height="50"></svg>`)).toEqual({ x: 0, y: 0, w: 100, h: 50 })
    expect(viewBoxOf(`<svg></svg>`)).toBeNull()
  })
})

describe('svgTargetGeometry', () => {
  const ELEV = `<svg viewBox="0 0 200 520"><g id="car"><rect x="20" y="380" width="155" height="90"/><line x1="20" y1="400" x2="175" y2="400"/></g><rect id="lamp" x="178" y="385" width="10" height="14"/></svg>`
  it('aggregates a <g> target bbox from child rect+line', () => {
    const g = svgTargetGeometry(ELEV, 'car')
    expect(g).toEqual({ ok: true, minX: 20, minY: 380, maxX: 175, maxY: 470 })
  })
  it('simple rect target', () => {
    expect(svgTargetGeometry(ELEV, 'lamp')).toEqual({ ok: true, minX: 178, minY: 385, maxX: 188, maxY: 399 })
  })
  it('bails on path inside target', () => {
    const g = svgTargetGeometry(`<svg viewBox="0 0 10 10"><g id="t"><path d="M0 0L5 5"/></g></svg>`, 't')
    expect(g.ok).toBe(false)
  })
  it('bails when target or ancestor has transform', () => {
    expect(svgTargetGeometry(`<svg viewBox="0 0 10 10"><g transform="translate(1,1)"><rect id="t" width="2" height="2"/></g></svg>`, 't').ok).toBe(false)
    expect(svgTargetGeometry(`<svg viewBox="0 0 10 10"><rect id="t" transform="scale(2)" width="2" height="2"/></svg>`, 't').ok).toBe(false)
  })
  it('bails when target is a descendant of another bound target (nested rig)', () => {
    const svg = `<svg viewBox="0 0 10 10"><g id="arm"><rect id="clamp" x="-22" y="0" width="4" height="4"/></g></svg>`
    expect(svgTargetGeometry(svg, 'clamp', new Set(['arm'])).ok).toBe(false)
    expect(svgTargetGeometry(svg, 'clamp', new Set()).ok).toBe(true)  // 无祖先绑定时可解析
  })
  it('fails on missing id / no measurable geometry', () => {
    expect(svgTargetGeometry(ELEV, 'nope').ok).toBe(false)
    expect(svgTargetGeometry(`<svg viewBox="0 0 9 9"><g id="t"></g></svg>`, 't').ok).toBe(false)
  })
  it('circle as the target itself', () => {
    expect(svgTargetGeometry(`<svg viewBox="0 0 20 20"><circle id="t" cx="5" cy="5" r="3"/></svg>`, 't'))
      .toEqual({ ok: true, minX: 2, minY: 2, maxX: 8, maxY: 8 })
  })
})

describe('validateSceneSpec geometry gate', () => {
  const ELEV_SVG = `<svg viewBox='0 0 200 520'><g id='car'><rect x='20' y='380' width='155' height='90'/></g></svg>`
  const part = (effect: any): SceneSpec => ({
    version: '1', canvas: { width: 380, height: 560 },
    parts: [{ id: 'shaft', kind: 'custom', x: 0, y: 0, svg: ELEV_SVG,
      bindings: [{ variable: 'car_pos', target: 'car', effect }] }],
  })
  it('ERROR when the from end pushes the target fully outside the viewBox, with migration guidance', () => {
    const r = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 390, to: 100 }), ['car_pos'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/相对位移/)
    expect(r.errors.join(' ')).toMatch(/yFrom:390/)
    expect(r.errors.join(' ')).toMatch(/yTo:100/)
  })
  it('correct relative offsets pass (skeleton-D style)', () => {
    const r = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 0, to: -280 }), ['car_pos'])
    expect(r.errors).toEqual([])
  })
  it('to-end fully outside → warning only (intentional exit animation)', () => {
    const r = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 0, to: 600 }), ['car_pos'])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/to 端/)
  })
  it('silently bails on nested rig (target inside another bound target)', () => {
    const svg = `<svg viewBox='0 0 100 100'><g id='arm'><rect id='clamp' x='-22' y='0' width='4' height='4'/></g></svg>`
    const r = validateSceneSpec({ version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'p', kind: 'custom', x: 0, y: 0, svg, bindings: [
        { variable: 'a', target: 'arm', effect: { type: 'translateY', valueFrom: 0, valueTo: 1, from: 0, to: 10 } },
        { variable: 'b', target: 'clamp', effect: { type: 'translateX', valueFrom: 0, valueTo: 1, from: 0, to: -9 } },
      ] }] }, ['a', 'b'])
    expect(r.errors).toEqual([])   // clamp 因祖先 arm 是绑定目标而 bail,无 ERROR 无 warning
  })
  it('from-end AND to-end both outside → single ERROR (not degraded to warning)', () => {
    const r = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 390, to: 600 }), ['car_pos'])
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBe(1)
    expect(r.warnings.filter((w) => /to 端/.test(w))).toHaveLength(0)
  })
  it('bypass scene: absolute fields without derived from/to → precise error', () => {
    const r = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, yFrom: 390, yTo: 100 }), ['car_pos'])
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/lowering/)
  })
  it('lowered scene (consistent metadata) passes; hand-edited yFrom → mismatch warning', () => {
    const ok = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 10, to: -280, yFrom: 390, yTo: 100 }), ['car_pos'])
    expect(ok.errors).toEqual([])
    expect(ok.warnings.filter((w) => w.includes('不一致'))).toEqual([])
    const bad = validateSceneSpec(part({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 10, to: -280, yFrom: 200, yTo: 100 }), ['car_pos'])
    expect(bad.warnings.join(' ')).toMatch(/不一致/)
  })
})

describe('lowerAbsoluteTranslate', () => {
  const ELEV_SVG = `<svg viewBox='0 0 200 520'><g id='car'><rect x='20' y='380' width='155' height='90'/></g></svg>`
  const scene = (effect: any): SceneSpec => ({
    version: '1', canvas: { width: 380, height: 560 },
    parts: [{ id: 'shaft', kind: 'custom', x: 0, y: 0, svg: ELEV_SVG,
      bindings: [{ variable: 'car_pos', target: 'car', effect }] }],
  })
  it('lowers yFrom/yTo into relative from/to using the target bbox top edge', () => {
    const s = scene({ type: 'translateY', valueFrom: 0, valueTo: 300, yFrom: 390, yTo: 100 })
    const r = lowerAbsoluteTranslate(s)
    expect(r.errors).toEqual([])
    const eff = s.parts[0].bindings[0].effect as any
    expect(eff.from).toBe(10)      // 390 - bboxMinY(380)
    expect(eff.to).toBe(-280)      // 100 - 380
    expect(eff.yFrom).toBe(390)    // 元数据保留
  })
  it('rejects mixing relative and absolute fields', () => {
    const r = lowerAbsoluteTranslate(scene({ type: 'translateY', valueFrom: 0, valueTo: 1, from: 0, to: 1, yFrom: 0, yTo: 1 }))
    expect(r.errors.join(' ')).toMatch(/同时/)
  })
  it('rejects axis mismatch and incomplete pairs', () => {
    expect(lowerAbsoluteTranslate(scene({ type: 'translateX', valueFrom: 0, valueTo: 1, yFrom: 0, yTo: 1 })).errors.join(' ')).toMatch(/xFrom/)
    expect(lowerAbsoluteTranslate(scene({ type: 'translateY', valueFrom: 0, valueTo: 1, yFrom: 0 })).errors.join(' ')).toMatch(/成对/)
    // translateY + xFrom/xTo(对称轴向错误)
    expect(lowerAbsoluteTranslate(scene({ type: 'translateY', valueFrom: 0, valueTo: 1, xFrom: 0, xTo: 1 })).errors.join(' ')).toMatch(/yFrom/)
    // translateAlong 带绝对字段 → 仅 translateX/translateY 支持
    expect(lowerAbsoluteTranslate(scene({ type: 'translateAlong', host: 'belt', variable: 'p', valueFrom: 0, valueTo: 1, yFrom: 0, yTo: 1 })).errors.join(' ')).toMatch(/translateX\/translateY/)
  })
  it('rejects loudly when target geometry is unparseable (path)', () => {
    const s: SceneSpec = { version: '1', canvas: { width: 10, height: 10 },
      parts: [{ id: 'p', kind: 'custom', x: 0, y: 0, svg: `<svg viewBox='0 0 9 9'><path id='t' d='M0 0'/></svg>`,
        bindings: [{ variable: 'v', target: 't', effect: { type: 'translateY', valueFrom: 0, valueTo: 1, yFrom: 0, yTo: 5 } as any }] }] }
    expect(lowerAbsoluteTranslate(s).errors.join(' ')).toMatch(/无法确定/)
  })
})
