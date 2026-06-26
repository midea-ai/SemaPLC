import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createHash } from 'crypto'
import { handleBuildSimulation } from '../../src/tools/buildSimulation.js'
import type { SceneSpec } from '../../src/tools/sceneSpec.js'

const TRAFFIC = `PROGRAM p
  VAR red_led AT %QX0.0 : BOOL; green_led AT %QX0.1 : BOOL; END_VAR
END_PROGRAM`

const MOTOR = `PROGRAM p
  VAR
    start_btn AT %IX0.0 : BOOL;
    stop_btn AT %IX0.1 : BOOL;
    motor AT %QX0.0 : BOOL;
  END_VAR
END_PROGRAM`

const ONE_BTN = `PROGRAM p
  VAR start_btn AT %IX0.0 : BOOL; motor AT %QX0.0 : BOOL; END_VAR
END_PROGRAM`

// fill map with on+off states (avoids the sticky-fill warning)
const FILL = { type: 'fill' as const, map: [
  { when: { eq: true }, color: '#22c55e' }, { when: { eq: false }, color: '#555' } ] }

function tmpScenePath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sim-')), 'scene.json')
}

describe('handleBuildSimulation', () => {
  it('auto-suggests a scene from stCode when none is given, and writes scene.json', async () => {
    const sceneFile = tmpScenePath()
    const r = await handleBuildSimulation({ stCode: TRAFFIC }, { sceneFile })
    expect(r.ok).toBe(true)
    expect(r.autoSuggested).toBe(true)
    expect(r.partCount).toBe(2)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as SceneSpec
    expect(written.parts).toHaveLength(2)
  })
  it('validates an agent-authored scene against the program IO and rejects unknown variables', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'x', kind: 'lamp', x: 0, y: 0, bindings: [
        { variable: 'does_not_exist', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] }],
    }
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/does_not_exist/)
  })
  it('does not write scene.json when validation fails', async () => {
    const sceneFile = tmpScenePath()
    const scene = { version: '1', canvas: {}, parts: [] } as unknown as SceneSpec
    await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(fs.existsSync(sceneFile)).toBe(false)
  })
  it('does not crash when a part has bindings as an empty object {} (coerces to [])', async () => {
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'x', kind: 'lamp', x: 0, y: 0, bindings: {} }],
    } as unknown as SceneSpec
    // must RESOLVE (not throw "object is not iterable") — an empty-binding lamp is allowed
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r).toBeTruthy()
    expect(typeof r.ok).toBe('boolean')
  })
  it('coerces object-shaped bindings {"0":{...}} to an array', async () => {
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'x', kind: 'lamp', x: 0, y: 0, bindings: { '0': { variable: 'red_led', effect: FILL } } }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(true)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as SceneSpec
    expect(Array.isArray(written.parts[0].bindings)).toBe(true)
    expect(written.parts[0].bindings.length).toBe(1)
  })
  it('coerces a binding var/name key into variable (canonical scene.json) + warns', async () => {
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 120, height: 100 },
      parts: [
        { id: 'x', kind: 'lamp', x: 0, y: 0, bindings: [{ var: 'red_led', effect: FILL }] },
        { id: 'y', kind: 'lamp', x: 60, y: 0, bindings: [{ name: 'green_led', effect: FILL }] },
      ],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(true)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as SceneSpec
    // 落盘后是 canonical 的 variable,别名键已删除
    expect(written.parts[0].bindings[0].variable).toBe('red_led')
    expect((written.parts[0].bindings[0] as any).var).toBeUndefined()
    expect(written.parts[1].bindings[0].variable).toBe('green_led')
    expect((written.parts[1].bindings[0] as any).name).toBeUndefined()
    expect(r.warnings.join(' ')).toMatch(/variable/)
  })
  it('sizes a custom svg that has viewBox but no width/height (防膨胀溢出),落盘 canonical', async () => {
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 400, height: 300 },
      parts: [{ id: 'c', kind: 'custom', x: 10, y: 10,
        svg: '<svg viewBox="0 0 120 90"><rect id="t" width="10" height="10"/></svg>',
        bindings: [{ variable: 'red_led', target: 't', effect: FILL }] }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(true)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as SceneSpec
    const svg = (written.parts[0] as any).svg as string
    expect(svg).toMatch(/width="120"/)
    expect(svg).toMatch(/height="90"/)
  })
  it('coerces a bare-string effect ("text") into {type} so a valid binding survives', async () => {
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'c', kind: 'custom', x: 0, y: 0, svg: '<svg viewBox="0 0 100 100"><text id="t">0</text></svg>',
        bindings: [{ variable: 'red_led', target: 't', effect: 'text' }] }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(true)
    expect(fs.existsSync(sceneFile)).toBe(true)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as SceneSpec
    expect((written.parts[0].bindings[0].effect as any).type).toBe('text')
  })
  it('coerces a bare-string "fill" effect then rejects it with a precise empty-map error (not "unknown effect type")', async () => {
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'c', kind: 'custom', x: 0, y: 0, svg: '<svg viewBox="0 0 100 100"><circle id="a"/></svg>',
        bindings: [{ variable: 'red_led', target: 'a', effect: 'fill' }] }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/empty map|map/i)
    expect(r.errors.join(' ')).not.toMatch(/unknown effect type/i)
  })
  it('defaults a custom part missing top-level x/y to (0,0) with a warning, not a hard reject', async () => {
    // The model commonly draws a custom "整图" but omits each part's top-level x/y
    // (coordinates live inside the svg). That should normalize to (0,0) + a warning,
    // not fail validation and force the agent to fall back to a scattered dashboard.
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 200, height: 100 },
      parts: [{
        id: 'panel', kind: 'custom',
        svg: '<svg viewBox="0 0 200 100"><rect id="panel_led" width="20" height="20" fill="#555"/></svg>',
        bindings: [{ variable: 'red_led', target: 'panel_led', effect: FILL }],
      }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/x\/y/)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8')) as SceneSpec
    expect(written.parts[0].x).toBe(0)
    expect(written.parts[0].y).toBe(0)
  })
  it('x/y defaulting is orthogonal to the clickable-input gate — an unbound BOOL input still rejects', async () => {
    // Honesty guard (the sorter case): defaulting a missing x/y must NOT silently
    // rescue a scene that leaves a BOOL %IX input unclickable. MOTOR has start_btn/
    // stop_btn inputs; the custom part binds only the output, so the clickable gate
    // must still fire (ok:false, nothing written) even though x/y was defaulted.
    const sceneFile = tmpScenePath()
    const scene = {
      version: '1', canvas: { width: 200, height: 100 },
      parts: [{
        id: 'panel', kind: 'custom',
        svg: '<svg viewBox="0 0 200 100"><rect id="panel_motor" width="20" height="20" fill="#555"/></svg>',
        bindings: [{ variable: 'motor', target: 'panel_motor', effect: FILL }],
      }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: MOTOR, scene }, { sceneFile })
    expect(r.ok).toBe(false)                          // clickable gate still rejects
    expect(r.errors.join(' ')).toMatch(/start_btn|stop_btn|不可交互/)
    expect(r.warnings.join(' ')).toMatch(/x\/y/)      // x/y was still defaulted (normalize ran)
    expect(fs.existsSync(sceneFile)).toBe(false)      // not written on failure
  })
  it('errors when stCode has no located IO', async () => {
    const r = await handleBuildSimulation({ stCode: 'PROGRAM p VAR x : INT; END_VAR END_PROGRAM' }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/located IO|AT %/)
  })
  it('an io_map.yaml component hint overrides the name heuristic (lamp→tank)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sim-'))
    const ioMapFile = path.join(dir, 'io_map.yaml')
    fs.writeFileSync(ioMapFile, 'red_led: { component: tank }\n')
    const r = await handleBuildSimulation(
      { stCode: TRAFFIC },
      { sceneFile: path.join(dir, 'scene.json'), ioMapFile },
    )
    expect(r.ok).toBe(true)
    const part = r.scene!.parts.find(p => p.bindings[0].variable === 'red_led')!
    expect(part.kind).toBe('tank')
    expect(r.ioMapHints).toEqual({ red_led: 'tank' })
  })
  it('omits ioMapHints when no io_map file is given', async () => {
    const r = await handleBuildSimulation({ stCode: TRAFFIC }, { sceneFile: tmpScenePath() })
    expect(r.ioMapHints).toBeUndefined()
  })
  it('warns when a numeric var is bound to a BOOL part with a fill effect (counters-as-lamps mistype)', async () => {
    const st = 'PROGRAM p VAR count_out AT %QW0 : INT; END_VAR END_PROGRAM'
    const scene = {
      version: '1', canvas: { width: 200, height: 200 },
      parts: [{ id: 'l', kind: 'lamp', x: 10, y: 10,
        bindings: [{ variable: 'count_out', effect: { type: 'fill', map: [{ when: { eq: 0 }, color: '#000' }] } }] }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: st, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/count_out|numeric-display|数值量/)
  })
  it('accepts a scene passed as a JSON STRING (model serialized the object)', async () => {
    // Some models (e.g. MiniMax) stringify nested object tool-args, so `scene`
    // arrives as a JSON string. It must be parsed, not treated as the scene
    // (which used to fail with "canvas must have numeric width and height").
    const scene: SceneSpec = {
      version: '1', canvas: { width: 300, height: 200 },
      parts: [{ id: 'L', kind: 'lamp', x: 10, y: 10, bindings: [
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] }],
    }
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene: JSON.stringify(scene) as unknown as SceneSpec }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.autoSuggested).toBe(false)
    expect(r.partCount).toBe(1)
    expect(r.scene!.canvas.width).toBe(300)
  })
  it('reports a clear error when scene is a string but not valid JSON', async () => {
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene: '{not json' as unknown as SceneSpec }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/scene.*JSON|JSON.*scene/i)
  })
})

describe('handleBuildSimulation scene normalization (malformed model output)', () => {
  it('unwraps parts wrapped as {item:[...]} and coerces stringified numbers', async () => {
    // Two malformations seen in eval: parts wrapped in {item:[...]} and numeric
    // fields stringified. Both must be normalized before validation.
    const scene = {
      version: '1',
      canvas: { width: '800', height: '450' },
      parts: { item: [
        { id: 'L', kind: 'lamp', x: '10', y: '10', bindings: [
          { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
        ] },
      ] },
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.partCount).toBe(1)
    expect(r.scene!.canvas.width).toBe(800)
    expect(typeof r.scene!.canvas.width).toBe('number')
    expect(r.scene!.canvas.height).toBe(450)
    expect(r.scene!.parts[0].x).toBe(10)
    expect(typeof r.scene!.parts[0].x).toBe('number')
  })

  it('unwraps a single-object {item:{...}} into a one-element parts array', async () => {
    const scene = {
      version: '1',
      canvas: { width: 800, height: 450 },
      parts: { item: { id: 'L', kind: 'lamp', x: 10, y: 10, bindings: [
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] } },
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.partCount).toBe(1)
  })

  it('coerces stringified effect numeric fields (valueFrom/valueTo/from/to)', async () => {
    const scene = {
      version: '1',
      canvas: { width: 800, height: 450 },
      parts: [{ id: 't', kind: 'tank', x: 10, y: 10, bindings: [
        { variable: 'red_led', effect: { type: 'height', valueFrom: '0', valueTo: '1', from: '0', to: '10' } },
      ] }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    const eff = r.scene!.parts[0].bindings[0].effect as { valueTo: number; to: number }
    expect(eff.valueTo).toBe(1)
    expect(typeof eff.valueTo).toBe('number')
    expect(eff.to).toBe(10)
  })

  it('still rejects parts that are not an array (e.g. plain object) with a {item:...} hint', async () => {
    const scene = {
      version: '1',
      canvas: { width: 800, height: 450 },
      parts: { id: 'L', kind: 'lamp', x: 10, y: 10, bindings: [] },
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/parts 必须是数组.*\{item/)
  })

  it('unwraps a part\'s bindings wrapped as {item:[...]} into an array', async () => {
    // MiniMax wraps the bindings array too: bindings:{item:[...]}. Without
    // unwrapping, validateSceneSpec rejects with "bindings must be an array"
    // and the agent enters a retry loop (scene 3 deadlock root cause).
    const scene = {
      version: '1',
      canvas: { width: 800, height: 450 },
      parts: [{ id: 'L', kind: 'lamp', x: 10, y: 10, bindings: { item: [
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] } }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.scene!.parts[0].bindings)).toBe(true)
    expect(r.scene!.parts[0].bindings).toHaveLength(1)
  })

  it('unwraps a single-object bindings {item:{...}} into a one-element array', async () => {
    const scene = {
      version: '1',
      canvas: { width: 800, height: 450 },
      parts: [{ id: 'L', kind: 'lamp', x: 10, y: 10, bindings: { item:
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      } }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.scene!.parts[0].bindings)).toBe(true)
    expect(r.scene!.parts[0].bindings).toHaveLength(1)
  })

  it('unwraps an effect.map wrapped as {item:[...]} into an array', async () => {
    const scene = {
      version: '1',
      canvas: { width: 800, height: 450 },
      parts: [{ id: 'L', kind: 'lamp', x: 10, y: 10, bindings: [
        { variable: 'red_led', effect: { type: 'fill', map: { item: [{ when: { eq: true }, color: '#f00' }] } } },
      ] }],
    } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    const eff = r.scene!.parts[0].bindings[0].effect as { map: unknown[] }
    expect(Array.isArray(eff.map)).toBe(true)
    expect(eff.map).toHaveLength(1)
  })

  it('normalizes a stringified scene with {item} wrapper and string numbers', async () => {
    const raw = JSON.stringify({
      version: '1',
      canvas: { width: '800', height: '450' },
      parts: { item: [
        { id: 'L', kind: 'lamp', x: '10', y: '10', bindings: [
          { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
        ] },
      ] },
    })
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene: raw as unknown as SceneSpec }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.scene!.canvas.width).toBe(800)
  })
})

describe('handleBuildSimulation warnings passthrough', () => {
  it('returns warnings[] and folds them into summary when ok', async () => {
    // tank box(52×64@30,30 → 右 82/下 94)轻微溢出 78×88(<15%)→ warning,仍 ok
    // (显著溢出会被 S3 硬门拒;这里测的是 warning 透传,故用轻微溢出)
    const scene: SceneSpec = {
      version: '1', canvas: { width: 78, height: 88 },
      parts: [{ id: 't', kind: 'tank', x: 30, y: 30, bindings: [
        { variable: 'red_led', effect: { type: 'height', valueFrom: 0, valueTo: 1, from: 0, to: 10 } }] }],
    }
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(Array.isArray(r.warnings)).toBe(true)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.summary).toMatch(/警告|warning|⚠/i)
  })
  it('warnings is an empty array for a clean auto-suggested scene', async () => {
    const r = await handleBuildSimulation({ stCode: TRAFFIC }, { sceneFile: tmpScenePath() })
    expect(r.warnings).toEqual([])
  })
})

// Task 3 verification: F1 already wires warnings → summary; Task 2's v1-with-v2-fields
// warning now flows through without any additional buildSimulation.ts changes.
describe('handleBuildSimulation v2 warnings', () => {
  const ST = 'PROGRAM p VAR run AT %QX0.0 : BOOL; END_VAR END_PROGRAM'

  it('surfaces a v1-with-v2-fields warning in summary', async () => {
    // Uses a valve (not a conveyor) so this v1-with-v2-fields(snap) warning test
    // doesn't trip the scene-level conveyor-without-motion GATE (ok:false).
    const scene: SceneSpec = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [
        { id: 'gate', kind: 'valve', x: 0, y: 0, bindings: [
          { variable: 'run', effect: { type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] } },
        ] },
        { id: 'box', kind: 'lamp', x: 0, y: 0, snap: { to: 'gate', dx: 10, dy: 0 }, bindings: [] },
      ],
    }
    const r = await handleBuildSimulation({ stCode: ST, scene })
    expect(r.ok).toBe(true)
    expect(r.summary).toMatch(/version.*2|警告|warn/i)
  })
})

// Rule 1 (IO-level heuristic): a conveyor/belt/motor BOOL output but no INT
// output (no position quantity) → the workpiece can't move; warn the agent.
describe('handleBuildSimulation conveyor-without-position heuristic', () => {
  it('HARD-FAILS an auto-suggested lone conveyor (no INT) — the scene-level gate catches the frozen belt the auto-suggest would draw', async () => {
    // conveyor_run with no INT → suggestScene draws a lone conveyor with no
    // workpiece → the scene-level motion GATE fires (ok:false). This closes the
    // bail path where an agent dodges the gate by asking for an auto-suggestion.
    const ST = 'PROGRAM p VAR conveyor_run AT %QX0.0 : BOOL; END_VAR END_PROGRAM'
    const r = await handleBuildSimulation({ stCode: ST }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/传送带.*无工件移动|不满足运动需求|translateX/)
    // the IO-level position warning (root-cause hint) still surfaces alongside
    expect(r.warnings.join(' ')).toMatch(/位置|position|belt_pos|不会移动|translateX/i)
  })

  it('warns for a motor BOOL output with no INT either', async () => {
    const ST = 'PROGRAM p VAR motor_on AT %QX0.0 : BOOL; END_VAR END_PROGRAM'
    const r = await handleBuildSimulation({ stCode: ST }, { sceneFile: tmpScenePath() })
    expect(r.warnings.join(' ')).toMatch(/位置|position|不会移动/i)
  })

  it('does NOT warn when an INT position quantity is present alongside the conveyor', async () => {
    const ST = 'PROGRAM p VAR conveyor_run AT %QX0.0 : BOOL; belt_pos AT %QW0 : INT; END_VAR END_PROGRAM'
    const r = await handleBuildSimulation({ stCode: ST }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).not.toMatch(/无 INT 位置量|工件可能不会移动|no INT position/i)
  })

  it('does NOT warn when there is no conveyor/motor output at all', async () => {
    const r = await handleBuildSimulation({ stCode: TRAFFIC }, { sceneFile: tmpScenePath() })
    expect(r.warnings.join(' ')).not.toMatch(/无 INT 位置量|工件可能不会移动/i)
  })

  it('STILL warns when the only INT is a counter (count/cnt/total/sum), not a position quantity', async () => {
    // A conveyor BOOL + an INT named `count` must not suppress the warning: a
    // count is not a position quantity, so the workpiece still can't move.
    const ST = 'PROGRAM p VAR conveyor_run AT %QX0.0 : BOOL; part_count AT %QW0 : INT; END_VAR END_PROGRAM'
    const r = await handleBuildSimulation({ stCode: ST }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/位置|position|不会移动|translateX/i)
  })
})

// Scene-level GATE (hard error, not a warning): a scene that DRAWS a conveyor/belt
// (incl. a custom svg whose markup mentions belt/conveyor) but has NO
// translateX/translateAlong binding anywhere → the workpiece won't travel along
// the belt. This is hard-gated to ok:false (scene.json not written) so the agent
// can't ship a belt with a frozen workpiece; a belt-less dashboard fallback passes.
describe('handleBuildSimulation scene-level conveyor-without-motion GATE', () => {
  const ST = 'PROGRAM p VAR run AT %QX0.0 : BOOL; END_VAR END_PROGRAM'

  it('HARD-FAILS (ok:false, scene.json not written) when a custom svg draws a belt but no binding uses translateX/translateAlong', async () => {
    const sceneFile = tmpScenePath()
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'plant', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 400 200"><rect id="belt" x="0" y="80" width="400" height="20"/></svg>',
        bindings: [
          { variable: 'run', target: 'belt', effect: { type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] } },
        ] }],
    }
    const r = await handleBuildSimulation({ stCode: ST, scene }, { sceneFile })
    expect(r.ok).toBe(false)
    expect(r.scene).toBeNull()
    expect(r.errors.join(' ')).toMatch(/传送带.*无工件移动|不满足运动需求|translateX/)
    expect(fs.existsSync(sceneFile)).toBe(false)
  })

  it('passes (ok:true) when the scene has a translateX binding moving a workpiece', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'plant', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 400 200"><rect id="belt" x="0" y="80" width="400" height="20"/><rect id="wp" x="0" y="60" width="20" height="20"/></svg>',
        bindings: [
          { variable: 'run', target: 'wp', effect: { type: 'translateX', valueFrom: 0, valueTo: 100, from: 0, to: 380 } },
        ] }],
    }
    const r = await handleBuildSimulation({ stCode: ST, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.errors.join(' ')).not.toMatch(/传送带.*无工件移动/)
  })

  it('passes (ok:true) for the canonical v2 form: a conveyor library part + a translateAlong workpiece on it', async () => {
    const ST = 'PROGRAM p VAR run AT %QX0.0 : BOOL; belt_pos AT %QW0 : INT; END_VAR END_PROGRAM'
    const scene: SceneSpec = {
      version: '2', canvas: { width: 400, height: 200 },
      parts: [
        { id: 'belt', kind: 'conveyor', x: 40, y: 100, bindings: [
          { variable: 'run', effect: { type: 'class', map: [{ when: { truthy: true }, className: 'sim-run' }] } },
        ] },
        { id: 'wp', kind: 'custom', x: 0, y: 0,
          svg: '<rect id="wp" x="-6" y="-6" width="12" height="12" fill="#f59e0b"/>',
          bindings: [
            { variable: 'belt_pos', target: 'wp', effect: { type: 'translateAlong', host: 'belt', axis: 'x', valueFrom: 0, valueTo: 100 } },
          ] },
      ],
    }
    const r = await handleBuildSimulation({ stCode: ST, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.errors.join(' ')).not.toMatch(/传送带.*无工件移动/)
  })

  it('passes (ok:true) when the scene has a translateY binding (vertical motion counts as workpiece movement)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 400 },
      parts: [{ id: 'plant', kind: 'custom', x: 0, y: 0,
        svg: '<svg viewBox="0 0 400 400"><rect id="belt" x="0" y="80" width="400" height="20"/><rect id="wp" x="0" y="60" width="20" height="20"/></svg>',
        bindings: [
          { variable: 'run', target: 'wp', effect: { type: 'translateY', valueFrom: 0, valueTo: 100, from: 0, to: 300 } },
        ] }],
    }
    const r = await handleBuildSimulation({ stCode: ST, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.errors.join(' ')).not.toMatch(/传送带.*无工件移动/)
  })

  it('passes (ok:true) for a belt-less dashboard fallback — no conveyor drawn, gate does not fire', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 400, height: 200 },
      parts: [{ id: 'l', kind: 'lamp', x: 0, y: 0, bindings: [
        { variable: 'run', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#22c55e' }] } },
      ] }],
    }
    const r = await handleBuildSimulation({ stCode: ST, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
  })
})

describe('handleBuildSimulation kind whitelist (uses PART_KINDS internally)', () => {
  it('rejects an unknown library kind before writing scene.json', async () => {
    const sceneFile = tmpScenePath()
    const scene: SceneSpec = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'x', kind: 'lamp-deluxe', x: 0, y: 0, bindings: [
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] }],
    }
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/lamp-deluxe/)
    expect(fs.existsSync(sceneFile)).toBe(false)
  })
  it('accepts a valid native kind (lamp)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'x', kind: 'lamp', x: 0, y: 0, bindings: [
        { variable: 'red_led', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f00' }] } },
      ] }],
    }
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
  })
})

describe('handleBuildSimulation clickable-input coverage gate', () => {
  it('HARD-gates a scene whose BOOL inputs have no clickable binding (the real bug)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 120 },
      parts: [{ id: 'panel', kind: 'custom', x: 10, y: 10,
        svg: '<svg viewBox="0 0 200 120"><circle id="panel_motor" cx="40" cy="40" r="10" fill="#555"/></svg>',
        bindings: [{ variable: 'motor', target: 'panel_motor', effect: FILL }] }],
    }
    const r = await handleBuildSimulation({ stCode: MOTOR, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/start_btn/)
    expect(r.errors.join(' ')).toMatch(/stop_btn/)
  })

  it('passes when every BOOL input has a custom binding whose target resolves', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 120 },
      parts: [{ id: 'panel', kind: 'custom', x: 10, y: 10,
        svg: '<svg viewBox="0 0 200 120"><rect id="panel_start" x="10" y="10" width="40" height="20"/><rect id="panel_stop" x="60" y="10" width="40" height="20"/></svg>',
        bindings: [
          { variable: 'start_btn', target: 'panel_start', effect: FILL },
          { variable: 'stop_btn', target: 'panel_stop', effect: FILL },
        ] }],
    }
    const r = await handleBuildSimulation({ stCode: MOTOR, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
  })

  it('passes when BOOL inputs are bound via library sensor-button parts (no target needed)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 120 },
      parts: [
        { id: 'b1', kind: 'sensor-button', x: 10, y: 10, bindings: [{ variable: 'start_btn', effect: FILL }] },
        { id: 'b2', kind: 'sensor-button', x: 70, y: 10, bindings: [{ variable: 'stop_btn', effect: FILL }] },
      ],
    }
    const r = await handleBuildSimulation({ stCode: MOTOR, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
  })

  it('skips the clickable gate when the program has no BOOL inputs (traffic light)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 120 },
      parts: [{ id: 'l', kind: 'lamp', x: 10, y: 10, bindings: [{ variable: 'red_led', effect: FILL }] }],
    }
    const r = await handleBuildSimulation({ stCode: TRAFFIC, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)
    expect(r.errors.join(' ')).not.toMatch(/不可交互/)
  })

  it('HARD-gates a custom target that mismatches the svg id by case (R1: mirrors case-sensitive querySelector)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 120, height: 60 },
      parts: [{ id: 'panel', kind: 'custom', x: 10, y: 10,
        svg: '<svg viewBox="0 0 120 60"><rect id="panel_startBtn" x="10" y="10" width="40" height="20"/></svg>',
        bindings: [{ variable: 'start_btn', target: 'panel_startbtn', effect: FILL }] }],
    }
    const r = await handleBuildSimulation({ stCode: ONE_BTN, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/start_btn/)
  })

  it('warns (does NOT hard-gate) when a custom input binding omits target (whole-image click collides)', async () => {
    const scene: SceneSpec = {
      version: '1', canvas: { width: 200, height: 120 },
      parts: [{ id: 'panel', kind: 'custom', x: 10, y: 10,
        svg: '<svg viewBox="0 0 200 120"><rect id="panel_bg" x="0" y="0" width="200" height="120"/></svg>',
        bindings: [
          { variable: 'start_btn', effect: FILL },
          { variable: 'stop_btn', effect: FILL },
        ] }],
    }
    const r = await handleBuildSimulation({ stCode: MOTOR, scene }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(true)                                  // 能点 → 不误报、不打回
    expect(r.warnings.join(' ')).toMatch(/target/)           // 但提示给按钮配 target
    expect(r.warnings.join(' ')).toMatch(/start_btn|stop_btn/)
  })
})

const ELEV_ST = `PROGRAM p
  VAR car_pos AT %QW0 : INT; call_1f AT %IX0.0 : BOOL; END_VAR
END_PROGRAM`
const ELEV_SVG = `<svg viewBox='0 0 200 520'><g id='car'><rect x='20' y='380' width='155' height='90'/></g><circle id='btn1' cx='10' cy='10' r='5'/></svg>`
const elevScene = (effect: unknown): SceneSpec => ({
  version: '1', canvas: { width: 380, height: 560 },
  parts: [{ id: 'shaft', kind: 'custom', x: 0, y: 0, svg: ELEV_SVG, bindings: [
    { variable: 'car_pos', target: 'car', effect: effect as any },
    { variable: 'call_1f', target: 'btn1', effect: { type: 'fill', map: [{ when: { eq: true }, color: '#f60' }, { when: { eq: false }, color: '#999' }] } },
  ] }],
})

describe('quantized position drive heuristic', () => {
  const SVG = `<svg viewBox='0 0 100 100'><rect id='cab' y='80' width='10' height='10'/></svg>`
  const sc = (): SceneSpec => ({ version: '1', canvas: { width: 100, height: 100 },
    parts: [{ id: 'p', kind: 'custom', x: 0, y: 0, svg: SVG,
      bindings: [{ variable: 'pos', target: 'cab', effect: { type: 'translateY', valueFrom: 0, valueTo: 3, from: 0, to: -60 } }] }] })
  it('warns when ALL assignments to a bound position var are constant literals', async () => {
    const st = `PROGRAM p VAR pos AT %QW0 : INT; s : INT; END_VAR
      CASE s OF 0: pos := 0; 1: pos := 100; 2: pos := 200; END_CASE; END_PROGRAM`
    const r = await handleBuildSimulation({ stCode: st, scene: sc() }, { sceneFile: tmpScenePath() })
    expect(r.warnings.join(' ')).toMatch(/常量直赋/)
  })
  it('no warning for self-incrementing ramp; affine-of-var is a documented miss (no warning)', async () => {
    const ramp = `PROGRAM p VAR pos AT %QW0 : INT; END_VAR pos := pos + 2; END_PROGRAM`
    const affine = `PROGRAM p VAR pos AT %QW0 : INT; f : INT; END_VAR pos := (f - 1) * 100; END_PROGRAM`
    for (const st of [ramp, affine]) {
      const r = await handleBuildSimulation({ stCode: st, scene: sc() }, { sceneFile: tmpScenePath() })
      expect(r.warnings.join(' ')).not.toMatch(/常量直赋/)
    }
  })
  it('ignores assignments inside ST comments', async () => {
    const st = `PROGRAM p VAR pos AT %QW0 : INT; END_VAR
      (* pos := 0; pos := 100; *)
      pos := pos + 2; END_PROGRAM`
    const r = await handleBuildSimulation({ stCode: st, scene: sc() }, { sceneFile: tmpScenePath() })
    expect(r.warnings.join(' ')).not.toMatch(/常量直赋/)
  })
})

describe('absolute-coordinate lowering via handleBuildSimulation', () => {
  it('normalizes stringified absolute fields ("390") before lowering', async () => {
    const sceneFile = tmpScenePath()
    const scene = { version: '1', canvas: { width: 100, height: 100 },
      parts: [{ id: 'p', kind: 'custom', x: 0, y: 0, svg: `<svg viewBox='0 0 100 100'><rect id='cab' y='80' width='10' height='10'/></svg>`,
        bindings: [{ variable: 'pos', target: 'cab', effect: { type: 'translateY', valueFrom: 0, valueTo: 3, yFrom: '80', yTo: '20' } }] }] } as unknown as SceneSpec
    const r = await handleBuildSimulation({ stCode: 'PROGRAM p VAR pos AT %QW0 : INT; END_VAR pos := pos + 1; END_PROGRAM', scene }, { sceneFile })
    expect(r.ok).toBe(true)
    const eff = JSON.parse(fs.readFileSync(sceneFile, 'utf8')).parts[0].bindings[0].effect
    expect(eff.from).toBe(0)    // 80 - bboxMinY(80)
    expect(eff.to).toBe(-60)    // 20 - 80
  })
  it('lowers yFrom/yTo, writes derived from/to + metadata, ok:true', async () => {
    const sceneFile = tmpScenePath()
    const r = await handleBuildSimulation({ stCode: ELEV_ST, scene: elevScene({ type: 'translateY', valueFrom: 0, valueTo: 300, yFrom: 390, yTo: 100 }) }, { sceneFile })
    expect(r.ok).toBe(true)
    const written = JSON.parse(fs.readFileSync(sceneFile, 'utf8'))
    const eff = written.parts[0].bindings[0].effect
    expect(eff.from).toBe(10); expect(eff.to).toBe(-280); expect(eff.yFrom).toBe(390)
  })
  it('the motivating bug (absolute written as relative) is rejected with migration guidance', async () => {
    const sceneFile = tmpScenePath()
    const r = await handleBuildSimulation({ stCode: ELEV_ST, scene: elevScene({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 390, to: 100 }) }, { sceneFile })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/yFrom:390/)
    expect(fs.existsSync(sceneFile)).toBe(false)
  })
  it('lowering error (mixed fields) → ok:false, nothing written', async () => {
    const sceneFile = tmpScenePath()
    const r = await handleBuildSimulation({ stCode: ELEV_ST, scene: elevScene({ type: 'translateY', valueFrom: 0, valueTo: 300, from: 0, to: 1, yFrom: 390, yTo: 100 }) }, { sceneFile })
    expect(r.ok).toBe(false)
    expect(fs.existsSync(sceneFile)).toBe(false)
  })
  it('absolute value itself out of viewBox is still caught by the geometry gate', async () => {
    const r = await handleBuildSimulation({ stCode: ELEV_ST, scene: elevScene({ type: 'translateY', valueFrom: 0, valueTo: 300, yFrom: 900, yTo: 1200 }) }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
  })
})

describe('verifyGate (先 verify 后出图,spec §4)', () => {
  const st = 'PROGRAM main VAR led AT %QX0.0 : BOOL; END_VAR END_PROGRAM'
  const sha = (s: string) => 'sha256:' + createHash('sha256').update(s).digest('hex')
  function gateOpts(dir: string, latest: object | null) {
    const latestFile = path.join(dir, 'latest.json')
    if (latest) fs.writeFileSync(latestFile, JSON.stringify(latest))
    return { sceneFile: null as any, ioMapFile: undefined, verifyGate: { latestFile, stHash: sha(st) } }
  }
  it('无 latest.json → ok:false 且提示先 verify', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'))
    const r = await handleBuildSimulation({ stCode: st }, gateOpts(dir, null))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/verify/)
  })
  it('hash 不匹配(改了 ST 没重验)→ ok:false', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'))
    const r = await handleBuildSimulation({ stCode: st }, gateOpts(dir, { stHash: 'sha256:other', ok: true, ts: 't' }))
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/版本|hash|重新 verify/)
  })
  it('hash 匹配且 ok:true → 放行;allowUnverified 显式旁路 → 放行', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'))
    const r1 = await handleBuildSimulation({ stCode: st }, gateOpts(dir, { stHash: sha(st), ok: true, ts: 't' }))
    expect(r1.errors.join()).not.toMatch(/先.*verify/)
    const r2 = await handleBuildSimulation({ stCode: st, allowUnverified: true } as any, gateOpts(dir, null))
    expect(r2.errors.join()).not.toMatch(/先.*verify/)
  })
})

describe('S1 plant 自驱硬门:运动效果绑定无 plant 的输入量 → 拒', () => {
  // level_raw 是 %IW 输入(程序不能写),valve_out 是 %QW 输出,level 是内部自驱量
  const PID = `PROGRAM p
  VAR
    setpoint_raw AT %IW0 : UINT;
    level_raw AT %IW1 : UINT;
    valve_out AT %QW0 : UINT;
    level : INT;
  END_VAR
  level := level + 1;
  valve_out := setpoint_raw;
END_PROGRAM`
  const heightEff = (v: string) => ({ variable: v, target: '#tank', effect: { type: 'height' as const, valueFrom: 0, valueTo: 10000, from: 0, to: 100 } })
  function scene(parts: any[]): SceneSpec {
    return { version: '1', canvas: { width: 400, height: 300 }, parts } as any
  }
  it('level_raw(%IW 输入)绑 height、无 slider/sensor-button → ok:false 且提示 plant/控件', async () => {
    const s = scene([{ id: 't', kind: 'custom', x: 10, y: 10, svg: '<rect id="tank" width="50" height="200"/>', bindings: [heightEff('level_raw')] }])
    const r = await handleBuildSimulation({ stCode: PID, scene: s }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/level_raw/)
    expect(r.errors.join()).toMatch(/plant|控件|死/)
  })
  it('level(内部自驱量)绑 height → 放行(程序写它)', async () => {
    const s = scene([{ id: 't', kind: 'custom', x: 10, y: 10, svg: '<rect id="tank" width="50" height="200"/>', bindings: [heightEff('level')] }])
    const r = await handleBuildSimulation({ stCode: PID, scene: s }, { sceneFile: tmpScenePath() })
    expect(r.errors.join()).not.toMatch(/level.*plant|死图.*level/)
  })
  it('valve_out(%QW 输出)绑 height → 放行(程序驱动输出)', async () => {
    const s = scene([{ id: 't', kind: 'custom', x: 10, y: 10, svg: '<rect id="tank" width="50" height="200"/>', bindings: [heightEff('valve_out')] }])
    const r = await handleBuildSimulation({ stCode: PID, scene: s }, { sceneFile: tmpScenePath() })
    expect(r.errors.join()).not.toMatch(/valve_out.*plant/)
  })
  it('输入量但绑在 slider 部件上(可交互驱动)→ 放行', async () => {
    const s = scene([{ id: 'sl', kind: 'slider', x: 10, y: 10, bindings: [{ variable: 'setpoint_raw', effect: { type: 'translateX' as const, valueFrom: 0, valueTo: 10000, from: 0, to: 100 } }] }])
    const r = await handleBuildSimulation({ stCode: PID, scene: s }, { sceneFile: tmpScenePath() })
    expect(r.errors.join()).not.toMatch(/setpoint_raw.*plant/)
  })
})

describe('S3 画布边界硬门:custom 整图显著溢出 → 拒', () => {
  const ST = `PROGRAM p
  VAR run AT %QX0.0 : BOOL; cnt AT %QW0 : INT; END_VAR
END_PROGRAM`
  function scene(parts: any[], cw = 400, ch = 300): SceneSpec {
    return { version: '1', canvas: { width: cw, height: ch }, parts } as any
  }
  const customAt = (x: number, y: number, vbw = 300, vbh = 200) => ({
    id: 'big', kind: 'custom', x, y,
    svg: `<svg viewBox="0 0 ${vbw} ${vbh}"><rect id="r" width="${vbw}" height="${vbh}"/></svg>`,
    bindings: [{ variable: 'cnt', target: '#r', effect: { type: 'height' as const, valueFrom: 0, valueTo: 100, from: 0, to: 200 } }],
  })
  it('custom viewBox 300x200 放在 x=200 的 400 宽画布(右溢 100=25%)→ ok:false', async () => {
    const r = await handleBuildSimulation({ stCode: ST, scene: scene([customAt(200, 10)]) }, { sceneFile: tmpScenePath() })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toMatch(/超出|溢出|画布|canvas/)
  })
  it('custom 在画布内(x=50,300宽 < 400)→ 不因溢出拒', async () => {
    const r = await handleBuildSimulation({ stCode: ST, scene: scene([customAt(50, 50)], 400, 300) }, { sceneFile: tmpScenePath() })
    expect(r.errors.join()).not.toMatch(/超出.*画布|画布.*溢出/)
  })
  it('轻微溢出(5px,<15%)→ 不硬拒', async () => {
    const r = await handleBuildSimulation({ stCode: ST, scene: scene([customAt(105, 10, 300, 200)], 400, 215) }, { sceneFile: tmpScenePath() })
    // x=105+300=405 超 400 仅 5px=1.25%;y=10+200=210<215 → 不硬拒
    expect(r.errors.join()).not.toMatch(/超出.*画布/)
  })
})
