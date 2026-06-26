import { describe, it, expect } from 'vitest'
import { suggestScene } from '../../src/tools/suggestScene.js'
import { detectIO } from '../../src/tools/detectIO.js'
import { validateSceneSpec } from '../../src/tools/sceneSpec.js'
import { PART_BOXES } from '../../src/tools/partsCatalog.js'

const TRAFFIC = `PROGRAM p
  VAR red_led AT %QX0.0 : BOOL; green_led AT %QX0.1 : BOOL; yellow_led AT %QX0.2 : BOOL; END_VAR
END_PROGRAM`

describe('suggestScene', () => {
  it('produces a lamp part per output LED, bound to its variable', () => {
    const io = detectIO(TRAFFIC).io
    const scene = suggestScene(io)
    expect(scene.parts).toHaveLength(3)
    expect(scene.parts.every(p => p.kind === 'lamp')).toBe(true)
    expect(scene.parts.map(p => p.bindings[0].variable)).toEqual(['red_led', 'green_led', 'yellow_led'])
  })
  it('output of its own validation', () => {
    const io = detectIO(TRAFFIC).io
    const scene = suggestScene(io)
    expect(validateSceneSpec(scene, io.map(e => e.name)).ok).toBe(true)
  })
  it('maps a numeric output to a numeric-display with a text effect', () => {
    const io = detectIO('VAR count_out AT %QW0 : INT; END_VAR').io
    const scene = suggestScene(io)
    expect(scene.parts[0].kind).toBe('numeric-display')
    expect(scene.parts[0].bindings[0].effect.type).toBe('text')
  })
  it('maps a BOOL input to a sensor-button', () => {
    const io = detectIO('VAR start_btn AT %IX0.0 : BOOL; END_VAR').io
    expect(suggestScene(io).parts[0].kind).toBe('sensor-button')
  })
  it('maps a BOOL output named "motor" to a motor part (not conveyor)', () => {
    const io = detectIO('VAR motor AT %QX0.0 : BOOL; END_VAR').io
    expect(suggestScene(io).parts[0].kind).toBe('motor')
  })
  it('keeps conveyor/belt names on the conveyor part (incl. conv_motor)', () => {
    expect(suggestScene(detectIO('VAR conv_motor AT %QX0.0 : BOOL; END_VAR').io).parts[0].kind).toBe('conveyor')
    expect(suggestScene(detectIO('VAR belt_run AT %QX0.0 : BOOL; END_VAR').io).parts[0].kind).toBe('conveyor')
  })
  it('maps an adjustable analog setpoint/manual input to a draggable slider', () => {
    expect(suggestScene(detectIO('VAR setpoint AT %IW0 : INT; END_VAR').io).parts[0].kind).toBe('slider')
    expect(suggestScene(detectIO('VAR manual_valve AT %IW1 : INT; END_VAR').io).parts[0].kind).toBe('slider')
  })
  it('a slider carries {min,max,step} params + a translateX(thumb) and text(value) binding', () => {
    const p = suggestScene(detectIO('VAR setpoint AT %IW0 : INT; END_VAR').io).parts[0]
    expect(p.params).toMatchObject({ min: 0, max: 100, step: 1 })
    expect(p.bindings.map((b) => b.effect.type).sort()).toEqual(['text', 'translateX'])
  })
  it('maps a plain numeric sensor reading (non-setpoint) to a read-only gauge, not a sensor-button', () => {
    const kind = suggestScene(detectIO('VAR pressure_raw AT %IW0 : INT; END_VAR').io).parts[0].kind
    expect(kind).not.toBe('sensor-button')
    expect(['gauge', 'numeric-display', 'tank']).toContain(kind)
  })
  it('maps a numeric level input to a tank (level-like name)', () => {
    const io = detectIO('VAR level_raw AT %IW0 : INT; END_VAR').io
    expect(suggestScene(io).parts[0].kind).toBe('tank')
  })
  it('maps a colored pusher (pusher_red/green) to a cylinder, not a lamp (color regex must not win over push)', () => {
    expect(suggestScene(detectIO('VAR pusher_red AT %QX0.0 : BOOL; END_VAR').io).parts[0].kind).toBe('cylinder')
    expect(suggestScene(detectIO('VAR pusher_green AT %QX0.0 : BOOL; END_VAR').io).parts[0].kind).toBe('cylinder')
  })
  it('still maps a colored lamp (red_lamp/green_light) to a lamp', () => {
    expect(suggestScene(detectIO('VAR red_lamp AT %QX0.0 : BOOL; END_VAR').io).parts[0].kind).toBe('lamp')
    expect(suggestScene(detectIO('VAR green_light AT %QX0.0 : BOOL; END_VAR').io).parts[0].kind).toBe('lamp')
  })
  it('skips unmapped memory variables', () => {
    const io = detectIO('VAR m AT %MW0 : INT; r AT %QX0.0 : BOOL; END_VAR').io
    const scene = suggestScene(io)
    expect(scene.parts).toHaveLength(1)
    expect(scene.parts[0].bindings[0].variable).toBe('r')
  })
})

describe('suggestScene with new kinds and box-aware layout', () => {
  it('maps a gauge component hint to a gauge part', () => {
    const io = detectIO('VAR flow AT %QW0 : INT; END_VAR').io
    io[0].component = 'gauge'
    expect(suggestScene(io).parts[0].kind).toBe('gauge')
  })
  it('maps a pump component hint to a pump part', () => {
    const io = detectIO('VAR p AT %QX0.0 : BOOL; END_VAR').io
    io[0].component = 'pump'
    expect(suggestScene(io).parts[0].kind).toBe('pump')
  })
  it('maps a hopper component hint to a hopper part', () => {
    const io = detectIO('VAR lvl AT %QW0 : INT; END_VAR').io
    io[0].component = 'hopper'
    expect(suggestScene(io).parts[0].kind).toBe('hopper')
  })
  it('never auto-places a requiresManualLayout kind (stack-light) even on a hint', () => {
    const io = detectIO('VAR alarm AT %QX0.0 : BOOL; END_VAR').io
    io[0].component = 'stack-light'
    expect(suggestScene(io).parts[0].kind).not.toBe('stack-light')
  })
  it('row height accounts for the tallest box so parts never overflow', () => {
    const io = detectIO('VAR a AT %QW0 : INT; b AT %QW1 : INT; END_VAR').io
    io[0].component = 'tank'; io[1].component = 'tank'
    const scene = suggestScene(io)
    const tankH = PART_BOXES['tank'].h
    for (const p of scene.parts) {
      expect(p.y + tankH).toBeLessThanOrEqual(scene.canvas.height)
    }
  })
})

describe('suggestScene v2 (snap + translateAlong + memory-bool)', () => {
  it('snaps a BOOL sensor onto a conveyor and bumps version to 2', () => {
    const io = detectIO('VAR conv AT %QX0.0 : BOOL; box_sensor AT %IX0.0 : BOOL; END_VAR').io
    const scene = suggestScene(io)
    expect(scene.version).toBe('2')
    const sensor = scene.parts.find(p => p.kind === 'sensor-button')!
    const conv = scene.parts.find(p => p.kind === 'conveyor')!
    expect(sensor.snap).toBeDefined()
    expect(sensor.snap!.to).toBe(conv.id)
  })

  it('adds a custom workpiece + translateAlong when an INT material-position exists', () => {
    const io = detectIO('VAR conv AT %QX0.0 : BOOL; pos AT %QW0 : INT; END_VAR').io
    const scene = suggestScene(io)
    expect(scene.version).toBe('2')
    const wp = scene.parts.find(p => p.kind === 'custom')
    expect(wp).toBeDefined()
    const along = wp!.bindings.find(b => b.effect.type === 'translateAlong')
    expect(along).toBeDefined()
    expect((along!.effect as any).host).toBe(scene.parts.find(p => p.kind === 'conveyor')!.id)
    // The translateAlong workpiece must be origin-placed: alongPosition() returns
    // ABSOLUTE coords (host.x + offset), so a non-zero part x/y would double-apply
    // the conveyor offset (group transform + absolute alongPosition). Must be (0,0).
    expect(wp!.x).toBe(0)
    expect(wp!.y).toBe(0)
  })

  it('includes a memory BOOL sensor as a part (filter relaxation)', () => {
    // %MX = memory-located BOOL with no Modbus mapping; relaxed filter keeps it.
    const io = detectIO('VAR conv AT %QX0.0 : BOOL; mem_sensor AT %MX0.0 : BOOL; END_VAR').io
    const scene = suggestScene(io)
    expect(scene.parts.some(p => p.label === 'mem_sensor')).toBe(true)
  })

  it('stays version 1 when there are no v2 features', () => {
    const io = detectIO('VAR red AT %QX0.0 : BOOL; END_VAR').io
    expect(suggestScene(io).version).toBe('1')
  })

  it('still validates clean', () => {
    const io = detectIO('VAR conv AT %QX0.0 : BOOL; pos AT %QW0 : INT; box_sensor AT %IX0.0 : BOOL; END_VAR').io
    const scene = suggestScene(io)
    expect(validateSceneSpec(scene, io.map(e => e.name)).ok).toBe(true)
  })
})
