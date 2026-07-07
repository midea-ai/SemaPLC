import { useEffect, useMemo, useRef } from 'react'
import { useSimStore } from '../../store/sim'
import { usePlcStore } from '../../store/plc'
import { useWsConnection } from '../../ws/useWsConnection'
import { PART_REGISTRY } from './parts'
import { PARTS_CATALOG } from './partsCatalog'
import { resolveEffect, applyPatch } from './resolveEffect'
import { resolveLayout, alongPosition } from './layout'
import type { PartInstance } from '../../../shared/protocol'
import { useT } from '../../i18n'
import './sim-runtime.css'

// Defensive: a scene written directly via write_file (bypassing plc_buildSimulation)
// can carry bindings as a bare object {} or {"0":...} instead of an array. Iterating it
// with for...of would crash the whole SimRuntime (white screen). Always read through this.
function bindingsOf(p: PartInstance): PartInstance['bindings'] {
  return Array.isArray(p.bindings) ? p.bindings : []
}

export function SimRuntime() {
  const t = useT()
  const scene = useSimStore((s) => s.scene)
  const sceneErrors = useSimStore((s) => s.sceneErrors)
  const values = usePlcStore((s) => s.values)
  const variableMap = usePlcStore((s) => s.variableMap)
  const plcStatus = usePlcStore((s) => s.status)
  const markForcing = usePlcStore((s) => s.markForcing)
  const { send, status: wsStatus } = useWsConnection()
  const interactive = wsStatus === 'open' && plcStatus === 'RUNNING'
  const svgRef = useRef<SVGSVGElement>(null)
  const layout = useMemo(() => (scene ? resolveLayout(scene) : null), [scene])

  // 防御:scene 经 write_file 直写或 buildSimulation 退化时,parts 可能不是数组、canvas 可能缺失。
  // 顶层 .map/.length/.width 一旦访问到坏值就在 render 阶段抛错 → 整页白屏(本组件无独立边界时)。
  // 全文统一走这两个归一值:坏 scene 最多渲成空舞台 + 上方错误横幅,绝不抛。
  const parts = Array.isArray(scene?.parts) ? scene!.parts : []
  const canvas = scene?.canvas ?? { width: 600, height: 360, background: undefined as string | undefined }

  // matiec lowercases located variable names, but agents author scene bindings using the
  // ST source casing (e.g. sensor_color_A → runtime sensor_color_a). IEC 61131-3 identifiers
  // are case-insensitive, so resolve scene-binding variables against the runtime variableMap
  // and values case-insensitively (otherwise mixed-case parts are dead: not clickable, no fill).
  const entryOf = useMemo(() => {
    const m = new Map(variableMap.map((v) => [v.name.toLowerCase(), v]))
    return (name: string) => m.get(name.toLowerCase())
  }, [variableMap])
  const valueOf = useMemo(() => {
    const m = new Map(Object.keys(values).map((k) => [k.toLowerCase(), values[k]]))
    return (name: string) => m.get(name.toLowerCase())
  }, [values])

  // A part is clickable iff one of its bindings targets a BOOL %I* input. Clicking
  // injects a momentary force pulse (rising edge) so input-driven logic (sensors,
  // buttons, counters) advances in simulation — where %IX would otherwise stay 0.
  const inputVarOf = (part: PartInstance): string | null => {
    for (const b of bindingsOf(part)) {
      const e = entryOf(b.variable)
      if (e && /^%I/i.test(e.location) && e.type.toUpperCase() === 'BOOL') return b.variable
    }
    return null
  }
  // Click a BOOL input → TOGGLE it (persistent force on, release back to 0 off), NOT a
  // momentary pulse. A maintained switch (start/stop/mode/enable) needs the input to STAY
  // true after one click — a 350ms auto-release pulse left it false (and was usually
  // invisible to the 500ms poll). Toggle also works for sensors/edge logic: each on-click
  // is a rising edge (= one part / one count); click again to clear for the next pass.
  const toggle = (name: string) => {
    // Read the LATEST value from the store (not a closure) — the click handler is
    // attached once per scene change, so a captured value would be stale.
    const vals = usePlcStore.getState().values
    const lower = name.toLowerCase()
    const cur = (vals[name] ?? Object.entries(vals).find(([k]) => k.toLowerCase() === lower)?.[1])?.value
    const isOn = cur === true || cur === 1 || cur === '1' || cur === 'true'
    markForcing(name)
    if (isOn) send({ type: 'plc:force', release: [name] })       // off → un-force back to 0
    else send({ type: 'plc:force', set: { [name]: true } })      // on → hold true
  }

  // D(spec 2026-06-10):custom 内按 id 绑定的可补间目标打 data-sim-tween,
  // 让 CSS transition 把 500ms 采样的属性阶跃补间掉——与库部件 [data-anchor] 同机制。
  // visible/text/class 不打(不可插值/已有 keyframe);scene 变更会重注入 svg,无需清理。
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !scene) return
    const TWEENABLE = new Set(['translateX', 'translateY', 'translateAlong', 'width', 'height', 'opacity', 'fill'])
    for (const part of parts) {
      if (part.kind !== 'custom') continue
      const group = svg.querySelector(`[data-part-id="${part.id}"]`)
      if (!group) continue
      for (const b of bindingsOf(part)) {
        if (!b.target || !b.effect || !TWEENABLE.has((b.effect as { type?: string }).type ?? '')) continue
        const el = group.querySelector(`[id="${b.target.replace(/["\\]/g, '\\$&')}"]`)
        if (el && !el.hasAttribute('data-sim-tween')) el.setAttribute('data-sim-tween', '')
      }
    }
  }, [scene])

  // Per-input click → pulse: attach to each input binding's TARGET element, NOT
  // the whole part group. A custom whole-scene image with multiple inputs
  // (e.g. presence_sensor + reset_button) must trigger each separately — the old
  // group-level onClick fired only the FIRST input on every click (incl. blank
  // areas of the custom svg). Library single-part inputs fall back to the group.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !scene || !interactive) return
    const cleanups: Array<() => void> = []
    for (const part of parts) {
      const group = svg.querySelector(`[data-part-id="${part.id}"]`)
      if (!group) continue
      for (const b of bindingsOf(part)) {
        const e = entryOf(b.variable)
        if (!e || !/^%I/i.test(e.location) || e.type.toUpperCase() !== 'BOOL') continue
        // custom whole-scene image: bind click to the specific input sub-element
        // (so sensor / reset etc. trigger separately, blank areas don't). Library
        // single-part: the whole part group is the clickable unit.
        const el = (part.kind === 'custom' && b.target
          ? (group.querySelector(`[id="${b.target.replace(/["\\]/g, '\\$&')}"]`) ?? group.querySelector(`[data-anchor="${b.target}"]`))
          : group) as SVGElement | null
        if (!el) continue
        const handler = (ev: Event) => { ev.stopPropagation(); toggle(b.variable) }
        el.style.cursor = 'pointer'
        el.addEventListener('click', handler)
        cleanups.push(() => { el.removeEventListener('click', handler); el.style.cursor = '' })
      }
    }
    return () => { for (const c of cleanups) c() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, variableMap, interactive])

  // Slider drag → force-write the bound numeric var. A slider's thumb (data-anchor
  // primary) is driven by live values via its translateX binding (read-back); during
  // drag the thumb follows the pointer optimistically (visual only) and the force is
  // committed ONCE on pointer-up. (Previously each rAF frame fired a force → a single
  // drag spammed dozens of plc:force → dozens of "强制变量" chat cards. Commit-on-release
  // mirrors a native <input type=range>'s change-not-input semantics.)
  // Only forceable located numerics (%I/%Q, non-BOOL) are draggable. Independent of the
  // BOOL-pulse path above (different kinds).
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !scene || !interactive) return
    const cleanups: Array<() => void> = []
    const lerp = (v: number, a: number, b: number, A: number, B: number) =>
      b === a ? A : A + ((v - a) / (b - a)) * (B - A)
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    for (const part of parts) {
      if (part.kind !== 'slider') continue
      const b = bindingsOf(part).find((bb) => bb.effect.type === 'translateX') as
        | { variable: string; effect: { valueFrom: number; valueTo: number; from: number; to: number } } | undefined
      if (!b) continue
      const entry = entryOf(b.variable)
      // forceable analog: located (%I/%Q) and not BOOL — mirrors plc-tools isForceable.
      if (!entry || !/^%[IQ]/i.test(entry.location) || entry.type.toUpperCase() === 'BOOL') continue
      const group = svg.querySelector(`[data-part-id="${part.id}"]`)
      const thumb = group?.querySelector('[data-anchor="primary"]') as SVGElement | null
      if (!group || !thumb) continue
      const { valueFrom: min, valueTo: max, from: x0, to: x1 } = b.effect
      const step = Number(part.params?.step) || 1
      const valueAt = (clientX: number, clientY: number): number => {
        const ctm = svg.getScreenCTM()
        if (!ctm) return min
        const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse())
        const localX = pt.x - part.x                          // part group is translated by part.x
        const frac = clamp((localX - x0) / (x1 - x0), 0, 1)
        const v = min + frac * (max - min)
        return clamp(Math.round(v / step) * step, Math.min(min, max), Math.max(min, max))
      }
      let dragging = false
      const onMove = (ev: PointerEvent) => {
        if (!dragging) return
        const v = valueAt(ev.clientX, ev.clientY)
        thumb.setAttribute('transform', `translate(${lerp(v, min, max, x0, x1)},0)`)  // optimistic, visual only — no force during drag
      }
      const onUp = (ev: PointerEvent) => {
        if (!dragging) return
        dragging = false
        markForcing(b.variable)
        send({ type: 'plc:force', set: { [b.variable]: valueAt(ev.clientX, ev.clientY) } })  // commit once on release
      }
      const onDown = (ev: PointerEvent) => { dragging = true; onMove(ev) }
      ;(group as SVGElement).style.cursor = 'ew-resize'
      group.addEventListener('pointerdown', onDown as EventListener)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      cleanups.push(() => {
        group.removeEventListener('pointerdown', onDown as EventListener)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        ;(group as SVGElement).style.cursor = ''
      })
    }
    return () => { for (const c of cleanups) c() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, variableMap, interactive])

  // Drive every binding from current PLC values whenever values or scene change.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !scene || !layout) return
    for (const part of parts) {
      const group = svg.querySelector(`[data-part-id="${part.id}"]`)
      if (!group) continue
      for (const b of bindingsOf(part)) {
        const entry = valueOf(b.variable)
        if (entry == null) continue
        const el = b.target
          ? (group.querySelector(`[id="${b.target.replace(/["\\]/g, '\\$&')}"]`) ?? group.querySelector(`[data-anchor="${b.target}"]`))
          : group.querySelector('[data-anchor="primary"]')
        if (!el) continue
        if (b.effect.type === 'translateAlong') {
          const eff = b.effect
          const host = layout.get(eff.host)
          if (!host) continue
          const hostPart = parts.find((p) => p.id === eff.host)
          const v = Number(entry.value)
          const t = (v - eff.valueFrom) / (eff.valueTo - eff.valueFrom)
          const pos = alongPosition(host, hostPart?.kind ?? 'conveyor', eff.axis ?? 'x', t)
          el.setAttribute('transform', `translate(${pos.x},${pos.y})`)
          continue
        }
        // A malformed binding (e.g. effect authored as a bare string, or an unknown
        // type) makes resolveEffect fall through to undefined — guard so one bad binding
        // is a silent no-op instead of crashing the whole SimRuntime (white screen). The
        // read-time scene-validation banner surfaces WHY it didn't animate.
        const patch = b.effect ? resolveEffect(b.effect, entry.value) : undefined
        if (patch) applyPatch(el, patch)
      }
    }
  }, [scene, values, layout])

  if (!scene) {
    return (
      <div className="sim-wrap">
        <div className="artifact-empty">
          <p className="ae-text">{t('sim.empty.title')}</p>
          <p className="ae-sub">{t('sim.empty.sub')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="sim-wrap">
      <div className="sim-bar">
        <span className="sim-live">{t('sim.bar.live')}</span>
        <span>{t('sim.bar.partCount', { count: parts.length })}</span>
        <span className="sim-spacer" />
      </div>
      {sceneErrors.length > 0 && (
        <div className="sim-scene-errors">
          <strong>{t('sim.scene.errBanner', { count: sceneErrors.length })}</strong>
          <ul>{sceneErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          <span className="sim-scene-errors-hint">{t('sim.scene.errHint')}</span>
        </div>
      )}
      <div className="sim-stage">
        <svg ref={svgRef}
             viewBox={`0 0 ${canvas.width} ${canvas.height}`}
             style={{ background: canvas.background ?? '#ffffff', border: '1px solid #e5e7eb', borderRadius: 8,
                      width: canvas.width, height: canvas.height, maxWidth: '100%', maxHeight: '100%' }}>
          {parts.map((p) => (
            <Part key={p.id} part={p} pose={layout?.get(p.id) ?? null}
                  input={interactive ? inputVarOf(p) : null} />
          ))}
        </svg>
      </div>
    </div>
  )
}

function Part({ part, pose, input }: {
  part: PartInstance
  pose: { x: number; y: number; rotation: number } | null
  input: string | null
}) {
  const t = useT()
  const x = pose?.x ?? part.x
  const y = pose?.y ?? part.y
  const rot = pose?.rotation ?? part.rotation ?? 0
  const transform = `translate(${x},${y})${rot ? ` rotate(${rot})` : ''}`
  const boxH = PARTS_CATALOG.find((d) => d.kind === part.kind)?.box.h ?? 64
  const label = part.label ? <text className="sim-label" x={0} y={boxH + 14}>{part.label}</text> : null
  const inner = part.kind === 'custom'
    ? <g dangerouslySetInnerHTML={{ __html: sanitizeSvg(sizeCustomSvg(part.svg ?? '')) }} />
    : (PART_REGISTRY[part.kind] ? PART_REGISTRY[part.kind](part.params ?? {}) : <text className="sim-label" y={20}>?{part.kind}</text>)
  // Click handlers are attached per input-binding target element in SimRuntime's
  // effect (so a custom whole-scene image with multiple inputs triggers each
  // separately). custom: NO group-level 'interactive' (would make the whole image
  // show a pointer cursor) — its sub-elements get an inline cursor. Library parts:
  // the whole part is the clickable unit, so keep 'interactive' for the cursor.
  const groupProps = (input && part.kind !== 'custom')
    ? { className: 'sim-part interactive' }
    : { className: 'sim-part' }
  return (
    <g data-part-id={part.id} transform={transform} {...groupProps}>
      {input ? <title>{t('sim.part.clickInject')}</title> : null}
      {inner}
      {label}
    </g>
  )
}

// A nested <svg> with a viewBox but NO width/height defaults to 100% of the OUTER
// viewport (the 800×N canvas), so each custom part balloons to ~canvas size and
// overflows/overlaps (confirmed: multi-custom-part scenes render way past the canvas).
// Inject width/height = viewBox w/h so the part renders at its intended size at (x,y),
// and the nested svg's default overflow:hidden clips internal content back to that box.
function sizeCustomSvg(svg: string): string {
  return svg.replace(/<svg\b([^>]*)>/i, (m, attrs) => {
    const hasW = /\bwidth\s*=/i.test(attrs), hasH = /\bheight\s*=/i.test(attrs)
    if (hasW && hasH) return m
    const vb = attrs.match(/viewBox\s*=\s*['"]\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i)
    if (!vb) return m
    let a = attrs
    if (!hasW) a += ` width="${vb[1]}"`
    if (!hasH) a += ` height="${vb[2]}"`
    return `<svg${a}>`
  })
}

// Whitelist sanitiser for agent-generated custom SVG: keep drawing markup, strip
// scripts / event handlers / external refs. Defensive — the agent is trusted but
// SVG is injected as innerHTML.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
}
