import * as fs from 'fs'
import * as path from 'path'
import { detectIO } from './detectIO.js'
import { suggestScene } from './suggestScene.js'
import { validateSceneSpec, lowerAbsoluteTranslate, viewBoxOf, sizeCustomSvg, type SceneSpec } from './sceneSpec.js'
import { PART_KINDS, PART_BOXES } from './partsCatalog.js'
import { parseIoMap, applyIoMap } from './ioMap.js'

export interface BuildSimulationInput {
  stCode: string
  // Agent-authored scene; omit to auto-suggest from IO. Accepts a SceneSpec
  // object OR a JSON string of one — some models (e.g. MiniMax) serialize nested
  // object tool-args to a string, so we must parse rather than treat as the scene.
  scene?: SceneSpec | string
  allowUnverified?: boolean
}

export interface BuildSimulationOptions {
  sceneFile?: string    // absolute path to write scene.json (from PLC_SCENE_FILE); skip write if absent
  ioMapFile?: string    // optional io_map.yaml of component hints (from PLC_IO_MAP_FILE)
  verifyGate?: { latestFile: string; stHash: string }   // spec §4: enforce prior verify pass
}

export interface BuildSimulationResult {
  ok: boolean
  scene: SceneSpec | null
  partCount: number
  autoSuggested: boolean
  errors: string[]
  warnings: string[]
  ioMapHints?: Record<string, string>   // symbol → applied component hint (present only if any applied)
  sceneFile: string | null   // where it was written, or null
  summary: string
}

export async function handleBuildSimulation(
  input: BuildSimulationInput,
  opts: BuildSimulationOptions = {},
): Promise<BuildSimulationResult> {
  if (opts.verifyGate && !input.allowUnverified) {
    let latest: { stHash?: string; ok?: boolean } | null = null
    try { latest = JSON.parse(fs.readFileSync(opts.verifyGate.latestFile, 'utf8')) } catch { latest = null }
    if (!latest || latest.stHash !== opts.verifyGate.stHash || latest.ok !== true) {
      return { ok: false, scene: null, partCount: 0, autoSuggested: false, sceneFile: null,
        warnings: [],
        errors: [latest
          ? '当前 ST 版本与最近一次验证不一致(改了程序没重新 verify)。请先对当前 .st 跑 verify 通过后再出图;确需跳过传 allowUnverified:true。'
          : '该程序尚未通过 verify 验证。先写 plan.json 跑 verify(见 plan-schema.md),通过后再 buildSimulation;确需跳过传 allowUnverified:true。'],
        summary: '✗ 验证门拦截:stHash 不匹配或尚未通过 verify' }
    }
  }

  const io = detectIO(input.stCode ?? '').io
  if (io.filter(e => e.modbusType != null).length === 0) {
    return { ok: false, scene: null, partCount: 0, autoSuggested: false, sceneFile: null,
      warnings: [],
      errors: ['no located IO detected — the program needs AT %… declarations to drive a simulation'],
      summary: '✗ 未检测到 located IO,无法构建仿真' }
  }

  // Optional io_map.yaml hint layer: fill `component` so suggestScene biases the
  // part choice. The map only hints; the final binding is still the scene.
  let hintedIo = io
  const hints: Record<string, string> = {}
  if (opts.ioMapFile && fs.existsSync(opts.ioMapFile)) {
    hintedIo = applyIoMap(io, parseIoMap(fs.readFileSync(opts.ioMapFile, 'utf8')))
    for (const e of hintedIo) if (e.component) hints[e.name] = e.component
  }

  // Coerce a stringified scene (model serialized the object) into a SceneSpec.
  let provided: SceneSpec | undefined
  if (typeof input.scene === 'string') {
    try {
      provided = JSON.parse(input.scene) as SceneSpec
    } catch (e) {
      return { ok: false, scene: null, partCount: 0, autoSuggested: false, sceneFile: null,
        warnings: [],
        errors: [`scene 是字符串但不是合法 JSON(${e instanceof Error ? e.message : String(e)})——传 SceneSpec 对象或其合法 JSON 字符串`],
        summary: '✗ scene JSON 解析失败' }
    }
  } else {
    provided = input.scene
  }

  // Normalize two malformations models commonly emit: parts wrapped as
  // {item:[...]} / {item:{...}}, and numeric fields stringified. Runs after the
  // string→JSON parse, before validation.
  const normNotes = provided && typeof provided === 'object'
    ? normalizeScene(provided as unknown as Record<string, unknown>)
    : []

  // 绝对坐标 lowering(必须先于 validateSceneSpec,否则先撞"缺 numeric from/to"硬错)。
  // 就地把 xFrom/yFrom 等换算写入 effect.from/to;失败=硬错不写盘。
  if (provided && typeof provided === 'object') {
    const lowered = lowerAbsoluteTranslate(provided as unknown as SceneSpec)
    if (lowered.errors.length) {
      return { ok: false, scene: null, partCount: 0, autoSuggested: false, sceneFile: null,
        warnings: [], errors: lowered.errors,
        summary: `✗ 绝对坐标换算失败:${lowered.errors.length} 项问题` }
    }
    if (lowered.notes.length) normNotes.push(...lowered.notes)
  }

  const scene = provided ?? suggestScene(hintedIo)
  const autoSuggested = !provided

  if (provided && !Array.isArray((provided as { parts?: unknown }).parts)) {
    return { ok: false, scene: null, partCount: 0, autoSuggested: false, sceneFile: null,
      warnings: [],
      errors: ['parts 必须是数组,不要用 {item:...} 包裹'],
      summary: '✗ Scene 校验失败:parts 不是数组' }
  }

  const { ok: schemaOk, errors, warnings } = validateSceneSpec(scene, hintedIo.map(e => e.name), { partKinds: PART_KINDS, partBoxes: PART_BOXES })
  if (normNotes.length) warnings.push(...normNotes)
  let ok = schemaOk

  // Rule 1 (IO-level heuristic): a conveyor/belt/motor BOOL output but no INT
  // output to act as a position quantity → the workpiece can't move. Mirrors
  // suggestScene's conveyor+INT pairing (see suggestScene.ts intVar lookup).
  // Stays a warning: it flags a missing ST position quantity (root cause), but
  // the program may legitimately have no motion — the scene-level gate below is
  // the precise, machine-decidable failure.
  const conveyorWarning = checkConveyorWithoutPosition(hintedIo)
  if (conveyorWarning) warnings.push(conveyorWarning)

  // Scene-level completeness GATE (HARD error, not a warning): the scene DRAWS a
  // conveyor/belt (a conveyor/belt part, or a custom svg whose markup mentions
  // belt/conveyor) but NO binding anywhere moves a workpiece (translateX /
  // translateAlong) → the deliverable visibly contradicts a motion requirement
  // (a belt with a frozen workpiece). Hard-gated to ok:false (scene.json not
  // written) because prose guidance alone was shown to be ignorable; a belt-less
  // dashboard fallback draws no conveyor and so passes this gate naturally.
  const sceneConveyorWarning = checkSceneConveyorWithoutMotion(scene)
  if (sceneConveyorWarning) {
    errors.push(sceneConveyorWarning)
    ok = false
  }

  // S1 plant 自驱硬门:运动效果(平移/高度/旋转)绑定一个定位输入量(%I…),但程序
  // 无法写它、也没有 slider/sensor-button 控件驱动它 → 实时仿真恒为初值(死图)。
  // 精准命中"控制器有、plant 无"(如 PID 把液位反馈当 %IW 输入读、缺闭环 plant)。
  const plantError = checkMotionInputWithoutPlant(scene, hintedIo)
  if (plantError) {
    errors.push(plantError)
    ok = false
  }

  // S3 画布边界硬门:部件包围盒显著超出 canvas(>15%)→ 实际渲染会裁切(0611 P0 高频)。
  // custom 整图用 viewBox 取尺寸(老 warning 对 custom 失效:partBoxes['custom'] 不存在)。
  const overflowError = checkCanvasOverflow(scene)
  if (overflowError) {
    errors.push(overflowError)
    ok = false
  }

  // Rule 3 (mistype): a numeric (non-BOOL) variable bound to a BOOL-oriented part
  // (lamp/sensor-button/valve/cylinder) via a BOOL effect (fill/class/visible) —
  // a count/state INT rendered as a lamp shows nothing meaningful. Guide to
  // numeric-display(text) / gauge(rotate). Seen in palletizing (counters→lamps).
  const mistypeWarning = checkMistypedNumericParts(scene, hintedIo)
  if (mistypeWarning) warnings.push(mistypeWarning)

  // C' (narrowed, see spec 2026-06-10): a translate-bound position var whose ALL
  // ST assignments are constant literals → animation will only jump discretely.
  const quantWarning = checkQuantizedPositionDrive(scene, input.stCode)
  if (quantWarning) warnings.push(quantWarning)

  // Clickable-input coverage GATE (HARD error): every BOOL %I* input must be drivable
  // from the scene (a clickable binding). Mirrors the frontend's click-mount rules so
  // the gate never falsely rejects an input the frontend can actually click.
  const clickable = checkClickableInputCoverage(scene, hintedIo)
  if (clickable.unreachable.length) {
    const list = clickable.unreachable.map((e) => `${e.name}(${e.address})`).join(', ')
    errors.push(
      `仿真不可交互:程序的 BOOL 输入 [${list}] 在 scene 里没有可点击的绑定` +
      `(要么一条引用它的绑定都没有,要么 custom 绑定的 target 与 svg 里的 id 大小写不一致/写错),无法点击驱动。` +
      `修法二选一:① custom 给每个输入加带 id 的按钮元素(id 以 part.id 为前缀)+ 一条 {variable,target:'<id>',effect:{fill on/off}} 绑定;` +
      `② 库部件 sensor-button 绑该输入(整件可点,无需 target)。`)
    ok = false
  }
  if (clickable.collidingInputs.length) {
    warnings.push(
      `custom 绑定省了 target,整图都可点、点哪都触发(多按钮会互撞):` +
      `${clickable.collidingInputs.join('、')}——给每个按钮 svg 元素一个 id 并用 binding 的 target 指它`)
  }

  let written: string | null = null
  if (ok && opts.sceneFile) {
    fs.mkdirSync(path.dirname(opts.sceneFile), { recursive: true })
    fs.writeFileSync(opts.sceneFile, JSON.stringify(scene, null, 2) + '\n', 'utf8')
    written = opts.sceneFile
  }

  return {
    ok,
    scene: ok ? scene : null,
    partCount: scene.parts.length,
    autoSuggested,
    sceneFile: written,
    errors,
    warnings,
    ioMapHints: Object.keys(hints).length ? hints : undefined,
    summary: ok
      ? `✓ 已构建过程仿真:${scene.parts.length} 个部件${autoSuggested ? '(自动建议)' : ''}` +
        (warnings.length ? `(⚠ ${warnings.length} 项警告:${warnings.join(';')})` : '')
      : `✗ Scene 校验失败:${errors.length} 项问题`,
  }
}

// Rule 1: detect a conveyor/belt/motor BOOL output with no INT output that could
// serve as a position quantity. Same conveyor cue as suggestScene's chooseKind
// (name /conv|belt|run|motor/ or component conveyor/motor) and the same INT-output
// candidate (type INT, direction !== input). Returns a warning string or null.
function checkConveyorWithoutPosition(io: import('../types.js').DetectedIO[]): string | null {
  const isConveyorOut = (e: import('../types.js').DetectedIO) =>
    e.direction !== 'input' && e.type.toUpperCase() === 'BOOL' &&
    (/conveyor|belt|motor/.test(e.name.toLowerCase()) ||
      (e.component != null && /conveyor|belt|motor/.test(e.component.toLowerCase())))
  const hasConveyor = io.some(isConveyorOut)
  if (!hasConveyor) return null
  // A counter (count/cnt/total/sum) is an INT but NOT a position quantity, so it
  // must not suppress the warning — only a genuine position INT does.
  const hasIntPosition = io.some(e =>
    e.type.toUpperCase() === 'INT' && e.direction !== 'input' &&
    !/count|cnt|total|sum/i.test(e.name))
  if (hasIntPosition) return null
  return '检测到传送带/电机类输出但无 INT 位置量,工件可能不会移动——考虑加位置变量(如 belt_pos AT %QWn)+ translateX binding 让工件沿带滑动'
}

// Scene-level rule (hard gate, see call site): the scene draws a belt/conveyor
// but no binding moves a workpiece along it. Covers the main path where the whole
// plant (belt + pieces) is drawn inside one kind:"custom" svg, so we sniff the svg
// markup for belt cues rather than relying on part.kind alone. Returns an error
// string (forces ok:false at the call site) or null.
// S1: 运动效果(translate/width/height/rotate)绑一个定位输入量,且无 slider/
// sensor-button 控件驱动 → 死图。输入量程序无法写;输出量/内部量由程序驱动,放行。
const MOTION_EFFECTS = new Set(['translateX', 'translateY', 'width', 'height', 'rotate', 'translateAlong'])
const INTERACTIVE_KINDS = new Set(['slider', 'sensor-button'])
function checkMotionInputWithoutPlant(scene: SceneSpec, io: import('../types.js').DetectedIO[]): string | null {
  if (!Array.isArray(scene?.parts)) return null
  const inputs = new Set(io.filter(e => e.direction === 'input').map(e => e.name.toLowerCase()))
  if (inputs.size === 0) return null
  // 被 slider/sensor-button 部件绑定的变量 = 用户可交互驱动
  const interactive = new Set<string>()
  for (const p of scene.parts) {
    if (INTERACTIVE_KINDS.has(p?.kind as string)) {
      for (const b of p.bindings ?? []) if (b?.variable) interactive.add(b.variable.toLowerCase())
    }
  }
  const dead = new Set<string>()
  for (const p of scene.parts) {
    for (const b of p?.bindings ?? []) {
      const v = (b?.variable ?? '').toLowerCase()
      if (b?.effect?.type && MOTION_EFFECTS.has(b.effect.type) && inputs.has(v) && !interactive.has(v)) {
        dead.add(b.variable)
      }
    }
  }
  if (dead.size === 0) return null
  return `连续量 ${[...dead].join(', ')} 用运动效果(平移/高度/旋转)绑定,但它们是定位输入量(%I…)——程序无法写它、也没有 slider/sensor-button 控件驱动,实时仿真里会恒为初值(死图)。两条出路:① 在 ST 加 plant 自驱(改成内部量,如 level := level + k*valve_out,再把仿真绑到那个自驱量);② 给它绑一个 slider(模拟量)或 sensor-button(开关)让用户手动驱动。`
}

// S3: 部件包围盒超出 canvas 边界超过 15% → 渲染裁切。custom 整图尺寸取 viewBox(若有)
// 或 p.w/p.h;库部件取 PART_BOXES。轻微溢出(<15%)交给 validateSceneSpec 的 warning。
const OVERFLOW_FRAC = 0.15
function checkCanvasOverflow(scene: SceneSpec): string | null {
  if (!Array.isArray(scene?.parts)) return null
  const cw = scene.canvas?.width ?? 0
  const ch = scene.canvas?.height ?? 0
  if (cw <= 0 || ch <= 0) return null
  const bad: string[] = []
  for (const p of scene.parts) {
    if (typeof p?.x !== 'number' || typeof p?.y !== 'number') continue
    let w = (typeof p.w === 'number' ? p.w : undefined) ?? PART_BOXES[p.kind]?.w
    let h = (typeof p.h === 'number' ? p.h : undefined) ?? PART_BOXES[p.kind]?.h
    if ((w == null || h == null) && p.kind === 'custom' && typeof p.svg === 'string') {
      const vb = viewBoxOf(p.svg)
      if (vb) { w = w ?? vb.w; h = h ?? vb.h }
    }
    if (w == null || h == null || w <= 0 || h <= 0) continue
    const overR = (p.x + w) - cw, overB = (p.y + h) - ch, overL = -p.x, overT = -p.y
    const fx = Math.max(overR, overL) / cw
    const fy = Math.max(overB, overT) / ch
    if (fx > OVERFLOW_FRAC || fy > OVERFLOW_FRAC) {
      bad.push(`${p.id}(${w}×${h}@${p.x},${p.y})`)
    }
  }
  if (bad.length === 0) return null
  return `部件 ${bad.join(', ')} 显著超出 ${cw}×${ch} 画布(>15%),实际渲染会被裁切。调小部件坐标/尺寸,或调大 canvas 让整图容得下——所有部件包围盒必须在画布内。`
}

function checkSceneConveyorWithoutMotion(scene: SceneSpec): string | null {
  if (!Array.isArray(scene?.parts)) return null
  const beltCue = /belt|conveyor|传送带|皮带/i
  const drawsConveyor = scene.parts.some((p) => {
    if (p?.kind === 'conveyor' || p?.kind === 'belt') return true
    return p?.kind === 'custom' && typeof p.svg === 'string' && beltCue.test(p.svg)
  })
  if (!drawsConveyor) return null
  const hasMotion = scene.parts.some((p) =>
    Array.isArray(p?.bindings) &&
    p.bindings.some((b) => b?.effect?.type === 'translateX' || b?.effect?.type === 'translateY' || b?.effect?.type === 'translateAlong'))
  if (hasMotion) return null
  return '场景画了传送带却无工件移动 binding(translateX/translateAlong)——传送带上没有会动的工件,不满足运动需求。修法二选一:① 给工件绑一个自驱位置量(在 ST 里加 belt_pos AT %QWn 自增/回环,再 translateX 绑它);② 若本程序确无运动,改用不画传送带的库部件 dashboard。'
}

// Rule 3: a numeric (non-BOOL) variable bound to a BOOL-oriented part via a BOOL
// effect — meaningless (a count/state INT shown as a lamp's on/off color). Returns
// a guidance warning string or null.
function checkMistypedNumericParts(scene: SceneSpec, io: import('../types.js').DetectedIO[]): string | null {
  if (!Array.isArray(scene?.parts)) return null
  const typeOf = new Map(io.map((e) => [e.name, e.type.toUpperCase()]))
  const BOOL_KINDS = new Set(['lamp', 'sensor-button', 'valve', 'cylinder'])
  const BOOL_EFFECTS = new Set(['fill', 'class', 'visible'])
  const offenders: string[] = []
  for (const p of scene.parts) {
    if (!p || !BOOL_KINDS.has(p.kind as string)) continue
    for (const b of p.bindings ?? []) {
      const t = typeOf.get(b?.variable as string)
      const eff = (b?.effect as { type?: string })?.type
      if (t && t !== 'BOOL' && eff && BOOL_EFFECTS.has(eff)) offenders.push(`${b.variable}(${t})→${p.kind}`)
    }
  }
  if (!offenders.length) return null
  return `数值量被绑到 BOOL 类部件(${offenders.join('、')}):lamp/valve/cylinder 的 fill/class/visible 只对 BOOL 有意义,数值量应改 numeric-display(text 效果)或 gauge(rotate)`
}

// C'(收窄版,见 spec 2026-06-10):translate 绑定的位置量若全部 ST 赋值均为常量字面量
// (典型:CASE 档位直赋),动画只会离散跳变。只 warning;仿射映射(pos := (f-1)*100)是
// 已知漏报——靠 SKILL ramp prose + 渲染端补间(data-sim-tween)兜底。
function checkQuantizedPositionDrive(scene: SceneSpec, stCode: string): string | null {
  if (!Array.isArray(scene?.parts)) return null
  const vars = new Set<string>()
  for (const p of scene.parts) {
    for (const b of (Array.isArray(p?.bindings) ? p.bindings : []) as Array<Record<string, any>>) {
      const ty = b?.effect?.type
      if ((ty === 'translateX' || ty === 'translateY') && b?.variable) vars.add(String(b.variable))
      if (ty === 'translateAlong' && b?.effect?.variable) vars.add(String(b.effect.variable))
    }
  }
  const code = stCode.replace(/\(\*[\s\S]*?\*\)/g, '')   // 剥 (* ... *) 注释,免得注释里的 := 误报
  const flagged: string[] = []
  for (const name of vars) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rhs = [...code.matchAll(new RegExp(`\\b${esc}\\s*:=\\s*([^;]+);`, 'gi'))].map((m) => m[1].trim())
    if (rhs.length > 0 && rhs.every((r) => /^-?\d+(\.\d+)?$/.test(r))) flagged.push(name)
  }
  if (flagged.length === 0) return null
  return `位置量 [${flagged.join(', ')}] 的全部 ST 赋值均为常量直赋——动画将离散跳变。平滑移动应自驱渐进:MOVING 态 ` +
    '`pos := pos ± step` 每周期逼近目标(见 SKILL 连续运动一节)'
}

// Extract all element ids from a custom svg, case-PRESERVED (mirrors the frontend's
// case-sensitive querySelector('#id')). Same regex as sceneSpec's id scan.
// NOTE: the frontend ALSO resolves a target via [data-anchor="..."]; we scan only id=
// because sceneSpec rejects a non-id custom target before this gate. If sceneSpec ever
// accepts data-anchor targets, widen this scan in lockstep.
function svgIdsOf(svg: string): Set<string> {
  const ids = new Set<string>()
  for (const m of svg.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/g)) ids.add(m[1])
  return ids
}

// Clickable-input coverage. Mirrors SimRuntime.tsx: a BOOL %I* input is clickable iff
// some binding references it AND the frontend would attach a click handler:
//   - library part (kind !== 'custom') → whole part group is clickable (no target needed)
//   - custom + target → only if target resolves to an svg id, case-SENSITIVELY
//   - custom + no target → whole-image fallback (clickable, but any click fires it; collide)
// Returns the inputs that are unreachable (→ hard gate) and the inputs reachable only/also
// via a custom no-target binding (→ warning).
function checkClickableInputCoverage(
  scene: SceneSpec,
  io: import('../types.js').DetectedIO[],
): { unreachable: import('../types.js').DetectedIO[]; collidingInputs: string[] } {
  const boolInputs = io.filter((e) => e.type.toUpperCase() === 'BOOL' && e.direction === 'input')
  if (boolInputs.length === 0) return { unreachable: [], collidingInputs: [] }
  const parts = Array.isArray(scene?.parts) ? scene.parts : []
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

  const unreachable: import('../types.js').DetectedIO[] = []
  const collidingInputs: string[] = []   // consumed by the custom-no-target warning in handleBuildSimulation
  for (const e of boolInputs) {
    let reachable = false
    let sawCustomNoTarget = false
    for (const p of parts) {
      if (!p) continue
      for (const b of p.bindings ?? []) {
        if (!b?.variable || !eq(b.variable, e.name)) continue
        if (p.kind !== 'custom') { reachable = true; continue }
        if (!b.target) { reachable = true; sawCustomNoTarget = true; continue }
        if (typeof p.svg === 'string' && svgIdsOf(p.svg).has(b.target)) { reachable = true }
        // custom + target that doesn't resolve case-sensitively → this binding won't mount click
      }
    }
    if (!reachable) unreachable.push(e)
    else if (sawCustomNoTarget) collidingInputs.push(e.name)
  }
  return { unreachable, collidingInputs }
}

// Coerce a numeric-looking string to a number; leave everything else untouched.
function toNum(v: unknown): unknown {
  return typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)) ? Number(v) : v
}

// Unwrap a {item:[...]} / {item:{...}} wrapper (same malformation as scene.parts):
// take the first array value, or wrap a single object value into a one-element
// array. Returns the original value unchanged if it isn't such a wrapper.
function unwrapItem(v: unknown): unknown {
  if (Array.isArray(v) || v == null || typeof v !== 'object') return v
  const values = Object.values(v as Record<string, unknown>)
  const arr = values.find(x => Array.isArray(x))
  if (arr) return arr
  const obj = values.find(x => x != null && typeof x === 'object')
  return obj ? [obj] : v
}

// In-place normalization of model-emitted malformations. Returns notes for any
// defaulting applied (e.g. a part missing x/y), to be folded into result warnings.
function normalizeScene(scene: Record<string, unknown>): string[] {
  const notes: string[] = []
  // parts wrapped in {item:[...]} / {item:{...}}: take the first array value, or
  // wrap a single object value into a one-element array.
  const parts = scene.parts as Record<string, unknown> | undefined
  // Only treat as a wrapper if it doesn't itself look like a single part
  // (a part carries id/kind). A bare part object is left for validation to reject.
  if (parts != null && !Array.isArray(parts) && typeof parts === 'object'
      && !('id' in parts) && !('kind' in parts)) {
    const values = Object.values(parts)
    const arr = values.find(v => Array.isArray(v))
    if (arr) scene.parts = arr
    else {
      const obj = values.find(v => v != null && typeof v === 'object')
      if (obj) scene.parts = [obj]
    }
  }

  // canvas numeric fields
  const canvas = scene.canvas as Record<string, unknown> | undefined
  if (canvas && typeof canvas === 'object') {
    for (const k of Object.keys(canvas)) {
      if (k === 'background') continue
      canvas[k] = toNum(canvas[k])
    }
  }

  // per-part x/y and effect numeric fields
  if (Array.isArray(scene.parts)) {
    for (const p of scene.parts as Record<string, unknown>[]) {
      if (!p || typeof p !== 'object') continue
      // Default a missing / non-numeric top-level x/y to 0. The model often draws a
      // custom 整图 and leaves all coordinates inside the svg, omitting the part's own
      // x/y — a full-canvas overlay at (0,0) is usually what was intended. Genuine
      // mis-placement still surfaces via the overlap/overflow warnings. This beats a
      // hard reject that pushes the agent to fall back to a scattered dashboard.
      const nx = toNum(p.x), ny = toNum(p.y)
      const fx = typeof nx === 'number' && Number.isFinite(nx) ? nx : null
      const fy = typeof ny === 'number' && Number.isFinite(ny) ? ny : null
      if (fx == null || fy == null) {
        notes.push(`part "${String(p.id ?? '?')}": 缺顶层数字 x/y,已默认 (0,0)——空间型场景应是一个 custom 整图 part(x:0,y:0,整张 canvas 的 svg,子元素用 id+target 绑);若要分件定位,请给每个 part 顶层数字 x/y`)
      }
      p.x = fx ?? 0
      p.y = fy ?? 0
      // custom svg 缺 width/height → 渲染时膨胀撑满画布溢出;落盘前补成 viewBox 尺寸,
      // 使持久 scene.json canonical、且 checkCanvasOverflow 量的尺寸与渲染一致。
      if (typeof p.svg === 'string') p.svg = sizeCustomSvg(p.svg)
      // bindings wrapped as {item:[...]} / {item:{...}}: unwrap to an array.
      p.bindings = unwrapItem(p.bindings)
      // bindings as a bare object — empty {} (meaning "no bindings") or index-keyed
      // {"0":{...},"1":{...}} — instead of an array. Coerce to an array so validation +
      // the gate helpers (which `for...of p.bindings`) don't crash with "not iterable".
      if (p.bindings != null && typeof p.bindings === 'object' && !Array.isArray(p.bindings)) {
        p.bindings = Object.values(p.bindings as Record<string, unknown>)
      }
      const bindings = p.bindings
      if (Array.isArray(bindings)) {
        for (const b of bindings as Record<string, unknown>[]) {
          // 高频翻车:变量键写成 var/name/signal/… 而非 `variable`。就地改名(canonical 化
          // 落盘的 scene.json),否则校验只回"a binding is missing variable",模型看不出是
          // 字段名拼错,会一轮轮换写法猜(var→name→省略),曾连撞 13 次。
          if (b && typeof b === 'object' && b.variable == null) {
            const ALIASES = ['var', 'name', 'signal', 'variableName', 'varName', 'varname']
            const hit = ALIASES.find(k => typeof b[k] === 'string' && (b[k] as string).trim() !== '')
            if (hit) {
              b.variable = b[hit]
              delete b[hit]
              notes.push(`binding "${String(b.variable)}": 变量键写成了 "${hit}",已按 "variable" 处理——binding 的变量键必须叫 "variable"`)
            }
          }
          // A common malformation: effect written as a bare type string ("fill"/"text"/
          // "visible") instead of {type, ...}. Wrap it so validation reads effect.type;
          // a type that needs more (fill map / visible when) then fails with a PRECISE
          // error instead of the opaque "unknown effect type undefined".
          if (b && typeof b.effect === 'string') {
            b.effect = { type: b.effect }
            notes.push(`binding "${String(b.variable ?? '?')}": effect 写成了字符串,已包装成 {type:"${String((b.effect as Record<string, unknown>).type)}"}——若该类型需要 map/when/from-to,请补全`)
          }
          const eff = b?.effect as Record<string, unknown> | undefined
          if (eff && typeof eff === 'object') {
            // fill/class effect.map likewise wrapped as {item:[...]}: unwrap.
            if ('map' in eff) eff.map = unwrapItem(eff.map)
            for (const f of ['valueFrom', 'valueTo', 'from', 'to', 'xFrom', 'xTo', 'yFrom', 'yTo']) {
              if (f in eff) eff[f] = toNum(eff[f])
            }
          }
        }
      }
    }
  }
  return notes
}
