// Scene Spec — the contract between the agent (producer) and the frontend
// SimRuntime (consumer). Pure types + validation; no fs, no DOM.

export type ValueMatch =
  | { eq: number | boolean }
  | { gte: number; lt?: number }
  | { truthy: true }

// Flow a part along its host's local axis: t = clamp((v-valueFrom)/(valueTo-valueFrom), 0, 1).
// Used for "workpiece travels down the belt". host is a PartInstance.id; axis defaults to 'x'.
export interface TranslateAlongEffect {
  type: 'translateAlong'
  host: string
  axis?: 'x' | 'y'
  variable: string
  valueFrom: number
  valueTo: number
}

// Place a part relative to a host part: child.abs = host.abs + R(host.rotation)·(dx,dy).
export interface SnapTo {
  to: string
  dx: number
  dy: number
}

export type Effect =
  | { type: 'fill'; map: { when: ValueMatch; color: string }[] }
  | { type: 'visible'; when: ValueMatch }
  | { type: 'text'; format?: string; decimals?: number; suffix?: string }
  | { type: 'translateX'; valueFrom: number; valueTo: number; from: number; to: number; xFrom?: number; xTo?: number }
  | { type: 'translateY'; valueFrom: number; valueTo: number; from: number; to: number; yFrom?: number; yTo?: number }
  | { type: 'width'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'height'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'opacity'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'rotate'; degPerUnit?: number }
  | { type: 'class'; map: { when: ValueMatch; className: string }[] }
  | TranslateAlongEffect

export interface Binding {
  variable: string            // ST symbol name; must match a detectIO name
  target?: string             // element id (#id) or data-anchor name; omit = part primary anchor
  effect: Effect
}

export interface PartInstance {
  id: string                  // unique within the scene
  kind: string                // library part name OR "custom"
  x: number
  y: number
  w?: number
  h?: number
  rotation?: number
  label?: string
  params?: Record<string, unknown>
  svg?: string                // only for kind:"custom" — inline SVG; elements carry ids
  snap?: SnapTo               // v2: place relative to a host part (resolveLayout)
  bindings: Binding[]
}

export interface SceneSpec {
  version: '1' | '2'
  canvas: { width: number; height: number; background?: string }
  parts: PartInstance[]
}

// number/boolean coercion: bool → 0/1; everything compared numerically except
// eq with a numeric target which compares the parsed number exactly.
function asNum(v: number | boolean | string): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function matchValue(m: ValueMatch, value: number | boolean | string): boolean {
  const n = asNum(value)
  if ('eq' in m) {
    return typeof m.eq === 'boolean' ? (n !== 0) === m.eq : n === m.eq
  }
  if ('gte' in m) {
    return n >= m.gte && (m.lt == null || n < m.lt)
  }
  if ('truthy' in m) return n !== 0
  return false
}

const EFFECT_TYPES = new Set(['fill', 'visible', 'text', 'translateX', 'translateY', 'width', 'height', 'opacity', 'rotate', 'class', 'translateAlong'])

const KNOWN_PART_FIELDS = new Set([
  'id', 'kind', 'x', 'y', 'w', 'h', 'rotation', 'label',
  'params', 'svg', 'snap', 'bindings',
])

const BINDINGS_TYPOS = new Set([
  'effects', 'effect', 'binding', 'bindngs', 'bindigs',
  'animations', 'animation', 'actions',
])

export interface ValidateOpts {
  partKinds?: Set<string>
  partBoxes?: Record<string, { w: number; h: number }>
}

export interface ValidateResult { ok: boolean; errors: string[]; warnings: string[] }

// True iff a part carries any v2-only field.
function hasV2Fields(spec: SceneSpec): boolean {
  return spec.parts.some(
    (p) => p?.snap != null || (Array.isArray(p?.bindings) && p.bindings.some((b) => b?.effect?.type === 'translateAlong')),
  )
}

// Detect a cycle (or self-reference) in the snap parent graph. Returns the id at
// which a cycle was found, or null. Independent of resolveLayout's own guard.
function findSnapCycle(spec: SceneSpec): string | null {
  const parent = new Map<string, string>()
  for (const p of spec.parts) if (p?.id && p.snap?.to) parent.set(p.id, p.snap.to)
  for (const start of parent.keys()) {
    const seen = new Set<string>()
    let cur: string | undefined = start
    while (cur != null && parent.has(cur)) {
      if (seen.has(cur)) return start
      seen.add(cur)
      cur = parent.get(cur)
    }
  }
  return null
}

// v2 structural checks. NOTE (F7): these run ONLY for version === '2'. A v1 scene
// carrying a malformed translateAlong (missing host / valueFrom>=valueTo) is
// silently accepted by design — v1 ignores v2 fields — but a warning is emitted
// by hasV2Fields in validateSceneSpec so it is never truly silent.
function validateV2Extra(spec: SceneSpec, ids: Set<string>, known: Set<string>, errors: string[], warnings: string[]): void {
  // host id → its part kind, so translateAlong can check the host has a motion axis.
  const kindById = new Map<string, string>()
  for (const p of spec.parts) if (p?.id && typeof p.kind === 'string') kindById.set(p.id, p.kind)
  for (const p of spec.parts) {
    if (p?.snap) {
      const tag = `part "${p.id}"`
      if (typeof p.snap.to !== 'string' || !p.snap.to) errors.push(`${tag}: snap.to is required`)
      else if (p.snap.to === p.id) errors.push(`${tag}: snap.to may not be the part itself (self cycle)`)
      else if (!ids.has(p.snap.to)) errors.push(`${tag}: snap.to "${p.snap.to}" not found among parts`)
      if (typeof p.snap.dx !== 'number' || typeof p.snap.dy !== 'number') errors.push(`${tag}: snap.dx and snap.dy must be numbers`)
    }
    for (const b of p?.bindings ?? []) {
      const e = b?.effect
      if (e?.type !== 'translateAlong') continue
      const tag = `part "${p.id}" translateAlong`
      if (!e.host || !ids.has(e.host)) errors.push(`${tag}: host "${e.host}" not found among parts`)
      // Rule 2 (hard rule, highest priority): a custom host has no motion axis, so
      // translateAlong silently no-ops. Flow nested elements with translateX instead.
      else if (kindById.get(e.host) === 'custom') {
        warnings.push(`${tag}.host "${e.host}" 是 custom 部件(无运动轴),translateAlong 不会生效——custom 内部子元素请改用 translateX 局部平移`)
      }
      if (typeof e.valueFrom !== 'number' || typeof e.valueTo !== 'number' || !(e.valueFrom < e.valueTo)) {
        errors.push(`${tag}: requires valueFrom < valueTo (got ${e.valueFrom}..${e.valueTo})`)
      }
      if (known.size > 0 && e.variable && !known.has(e.variable)) {
        warnings.push(`${tag}: variable "${e.variable}" is not a located IO — flow will rest at default position if no value arrives`)
      }
    }
  }
  const cyc = findSnapCycle(spec)
  if (cyc) errors.push(`snap cycle detected starting at part "${cyc}"`)
}

/**
 * Structurally validate a SceneSpec. `knownVariables` = the detectIO names of the
 * running program; when non-empty, every binding.variable must be one of them
 * (except translateAlong variables, which may be internal — warned, not rejected).
 * Pass [] to skip the variable check (e.g. validating a scene without a program).
 * Pass `opts.partKinds` to reject unknown library kinds (kind:"custom" is always allowed).
 * Pass `opts.partBoxes` for visual sanity checks (overflow, overlap).
 */
export function validateSceneSpec(
  spec: SceneSpec,
  knownVariables: string[],
  opts: ValidateOpts = {},
): ValidateResult {
  const errors: string[] = []
  const warnings: string[] = []
  // matiec lowercases located variable names while scenes are authored in ST source
  // casing; IEC 61131-3 identifiers are case-insensitive, so compare case-insensitively
  // (otherwise mixed-case binding variables falsely read as "not a located IO").
  const known = new Set(knownVariables.map((v) => v.toLowerCase()))
  const partKinds = opts.partKinds
  const partBoxes = opts.partBoxes

  if (!spec || !['1', '2'].includes(spec.version as string)) {
    errors.push(`unsupported version (need "1" or "2", got ${JSON.stringify(spec?.version)})`)
  }
  if (!spec?.canvas || typeof spec.canvas.width !== 'number' || typeof spec.canvas.height !== 'number') {
    errors.push('canvas must have numeric width and height')
  }
  if (!Array.isArray(spec?.parts)) {
    errors.push('parts must be an array')
    return { ok: false, errors, warnings }
  }

  // v1 carrying v2 fields: not a hard error, but warn — layout/flow won't take effect.
  if (spec.version === '1' && hasV2Fields(spec)) {
    warnings.push('scene has version "1" but uses v2 fields (snap / translateAlong); they will be ignored — set version to "2"')
  }

  const ids = new Set<string>()
  for (const p of spec.parts) if (p?.id) ids.add(p.id)

  const cw = spec.canvas?.width ?? 0
  const ch = spec.canvas?.height ?? 0
  const seen = new Set<string>()
  const customIds = new Map<string, string[]>()   // custom element id → part ids declaring it
  const positions = new Map<string, string>()      // "x,y" → first part id

  for (const p of spec.parts) {
    const tag = `part "${p?.id ?? '?'}"`
    if (!p?.id || typeof p.id !== 'string') { errors.push(`${tag}: id required`); continue }
    if (seen.has(p.id)) errors.push(`duplicate part id "${p.id}"`)
    seen.add(p.id)
    if (typeof p.kind !== 'string' || !p.kind) errors.push(`${tag}: kind required`)
    if (partKinds && typeof p.kind === 'string' && p.kind && p.kind !== 'custom' && !partKinds.has(p.kind)) {
      errors.push(`${tag}: unknown part kind "${p.kind}" (not a library part; use kind:"custom" or a known kind)`)
    }
    if (typeof p.x !== 'number' || typeof p.y !== 'number') errors.push(`${tag}: x and y must be numbers`)

    for (const key of Object.keys(p)) {
      if (!KNOWN_PART_FIELDS.has(key)) {
        if (BINDINGS_TYPOS.has(key)) {
          const hasValidBindings = Array.isArray(p.bindings) && p.bindings.length > 0
          if (hasValidBindings) {
            warnings.push(`${tag}: unknown field "${key}" will be ignored (bindings already present)`)
          } else {
            errors.push(`${tag}: unknown field "${key}" — did you mean "bindings"?`)
          }
        } else {
          warnings.push(`${tag}: unknown field "${key}" will be ignored`)
        }
      }
    }

    if (p.kind === 'custom') {
      if (typeof p.svg !== 'string' || !p.svg.trim()) {
        errors.push(`${tag}: a custom part requires a non-empty svg string`)
      } else {
        if (!p.svg.includes('<')) errors.push(`${tag}: custom svg has no markup (no "<" found)`)
        if (!/viewBox/i.test(p.svg)) warnings.push(`${tag}: custom svg has no viewBox — element sizing may be unpredictable`)
        for (const m of p.svg.matchAll(/\bid\s*=\s*['"]([^'"]+)['"]/g)) {
          const id = m[1]
          if (!id.startsWith('def-')) {   // defs ids are namespaced separately
            const arr = customIds.get(id) ?? []
            arr.push(p.id)
            customIds.set(id, arr)
          }
        }
      }
    }

    if (typeof p.x === 'number' && typeof p.y === 'number') {
      const key = `${p.x},${p.y}`
      const prev = positions.get(key)
      if (prev) warnings.push(`${tag}: fully overlaps part "${prev}" at (${p.x},${p.y})`)
      else positions.set(key, p.id)

      const box = partBoxes?.[p.kind]
      const w = box?.w ?? 0
      const h = box?.h ?? 0
      if (p.x < 0 || p.y < 0 || p.x + w > cw || p.y + h > ch) {
        warnings.push(`${tag}: box (${w}×${h}) at (${p.x},${p.y}) overflows the ${cw}×${ch} canvas`)
      }
    }

    if (!Array.isArray(p.bindings)) { errors.push(`${tag}: bindings must be an array`); continue }

    // A custom svg with NO data bindings renders as a static dead-figure (the picture
    // never reacts to PLC values). Hard-reject only when the program HAS bindable IO
    // (known non-empty) — a decorative custom in an IO-less scene is legitimately static.
    if (p.kind === 'custom' && typeof p.svg === 'string' && p.svg.trim() && p.bindings.length === 0 && known.size > 0) {
      errors.push(`${tag}: custom svg 无任何数据绑定,画面会是静止死图——给要随值变化的 svg 元素加 bindings:[{variable,target:'<id>',effect:{type,map}}]`)
    }

    if (p.kind === 'stack-light' && p.bindings.length < 3) {
      warnings.push(`${tag}: stack-light usually needs 3 bindings (red/amber/green); got ${p.bindings.length}`)
    }

    // 本 part 内所有运动绑定的 target(几何门嵌套-bail 与后续 lowering 共用判据)
    const translateTargets = new Set<string>()
    if (p.kind === 'custom') for (const b of p.bindings) {
      const t = (b as { target?: string })?.target
      const ty = (b as { effect?: { type?: string } })?.effect?.type
      if (t && (ty === 'translateX' || ty === 'translateY' || ty === 'translateAlong')) translateTargets.add(t)
    }

    for (const b of p.bindings) {
      if (!b?.variable) { errors.push(`${tag}: a binding is missing variable`); continue }
      // translateAlong variables may be internal (e.g. a material-position INT) —
      // handled in validateV2Extra as a warning, not a hard reject.
      const isAlong = b.effect?.type === 'translateAlong'
      if (!isAlong && known.size > 0 && !known.has(b.variable.toLowerCase())) {
        errors.push(`${tag}: binding variable "${b.variable}" is not a located IO of the program`)
      }
      if (!b.effect || !EFFECT_TYPES.has(b.effect.type)) {
        errors.push(`${tag}: binding "${b.variable}" has an unknown effect type ${JSON.stringify(b.effect?.type)}`)
        continue
      }
      const eff = b.effect as Record<string, unknown>

      // translate 类校验共用的目标静态几何(一致性复核 + 几何门共享,只解析一次)
      const targetGeom = ((eff.type === 'translateX' || eff.type === 'translateY') &&
          p.kind === 'custom' && typeof p.svg === 'string' && b.target)
        ? (() => { const others = new Set(translateTargets); others.delete(b.target!); return svgTargetGeometry(p.svg!, b.target!, others) })()
        : null

      // 绝对字段读时处理:未 lowering(write_file 旁路直写)→ 精准 error;已 lowering → 元数据一致性复核
      // NOTE: 错轴绝对字段(如 translateY 上的 xFrom)不在读时检测——构建期 lowering 已硬拒,读到的 scene 不会有
      if (eff.type === 'translateX' || eff.type === 'translateY') {
        const isX = eff.type === 'translateX'
        const aFrom = isX ? (eff as Record<string, unknown>).xFrom : (eff as Record<string, unknown>).yFrom
        const aTo = isX ? (eff as Record<string, unknown>).xTo : (eff as Record<string, unknown>).yTo
        if (aFrom != null || aTo != null) {
          const k = isX ? 'xFrom/xTo' : 'yFrom/yTo'
          if (typeof (eff as Record<string, unknown>).from !== 'number' || typeof (eff as Record<string, unknown>).to !== 'number') {
            errors.push(`${tag}: binding "${b.variable}" 含绝对字段 ${k} 但无换算后的 from/to——绝对坐标需经 plc_buildSimulation lowering,请走工具重建 scene(勿直接 write_file config/scene.json)`)
            // 已报 lowering 错;无有效 from/to 时下游 numeric 校验/几何门都是噪音或空转,直接跳过
            continue
          }
          if (p.kind === 'custom' && typeof p.svg === 'string' && b.target &&
              typeof aFrom === 'number' && typeof aTo === 'number') {
            if (targetGeom && targetGeom.ok) {
              const base = isX ? targetGeom.minX : targetGeom.minY
              if (Math.abs((aFrom - base) - ((eff as Record<string, unknown>).from as number)) > 0.5 ||
                  Math.abs((aTo - base) - ((eff as Record<string, unknown>).to as number)) > 0.5) {
                warnings.push(`${tag}: binding "${b.variable}" 的 ${k} 与换算后 from/to 不一致——若手改了绝对值,请经 plc_buildSimulation 重建以重新换算`)
              }
            }
          }
        }
      }
      if (eff.type === 'translateX' || eff.type === 'translateY' || eff.type === 'width' || eff.type === 'height' || eff.type === 'opacity') {
        for (const f of ['valueFrom', 'valueTo', 'from', 'to']) {
          if (typeof eff[f] !== 'number') errors.push(`${tag}: binding "${b.variable}" ${eff.type} effect is missing numeric "${f}"`)
        }
      }
      // visible needs a `when` clause (resolveEffect reads effect.when); without it the
      // element's visibility never changes. Catches a bare-string "visible" effect that
      // normalizeScene wraps into {type:'visible'} but that carries no condition.
      if (eff.type === 'visible' && eff.when == null) {
        errors.push(`${tag}: binding "${b.variable}" visible effect is missing a "when" clause`)
      }
      if (eff.type === 'fill' || eff.type === 'class') {
        if (!Array.isArray(eff.map) || (eff.map as unknown[]).length === 0) {
          errors.push(`${tag}: binding "${b.variable}" ${eff.type} effect has an empty map`)
        } else if (eff.type === 'fill') {
          // sticky-fill: resolveEffect returns color:null on no match and applyPatch
          // never resets fill — so a map with only an on-state stays colored. We only
          // detect explicit off via {eq:false}/{eq:0}; gte-range off-states aren't flagged.
          const hasOff = (eff.map as { when: ValueMatch }[]).some((r) =>
            'eq' in r.when && (r.when.eq === false || r.when.eq === 0))
          if (!hasOff) warnings.push(`${tag}: binding "${b.variable}" fill map has no off-state ({eq:false}/{eq:0}) — the element may stay colored (sticky fill)`)
        }
      }
      if (p.kind === 'custom' && b.target && typeof p.svg === 'string') {
        const re = new RegExp(`\\bid\\s*=\\s*['"]${b.target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`)
        if (!re.test(p.svg)) {
          errors.push(`${tag}: binding target "${b.target}" not found as an id in the custom svg`)
        }
      }
      // 几何门:from 端(静止位)完全出 viewBox = ERROR;to 端 = warning(可能有意退场);过半出界 = warning
      if ((eff.type === 'translateX' || eff.type === 'translateY') &&
          p.kind === 'custom' && typeof p.svg === 'string' && b.target &&
          typeof eff.from === 'number' && typeof eff.to === 'number') {
        const vb = viewBoxOf(p.svg)
        if (vb) {
          if (targetGeom && targetGeom.ok) {
            const g = targetGeom
            const axis = eff.type === 'translateX' ? 'x' as const : 'y' as const
            const lo = axis === 'x' ? g.minX : g.minY, hi = axis === 'x' ? g.maxX : g.maxY
            const vlo = axis === 'x' ? vb.x : vb.y, vhi = axis === 'x' ? vb.x + vb.w : vb.y + vb.h
            const place = (off: number): 'out' | 'partial' | 'in' => {
              const a = lo + off, z = hi + off
              if (z <= vlo || a >= vhi) return 'out'
              return (Math.min(z, vhi) - Math.max(a, vlo)) < (z - a) * 0.5 ? 'partial' : 'in'
            }
            const absK = axis === 'x' ? 'xFrom' : 'yFrom'
            const absK2 = axis === 'x' ? 'xTo' : 'yTo'
            const fromState = place(eff.from as number), toState = place(eff.to as number)
            if (fromState === 'out') {
              errors.push(`${tag}: binding "${b.variable}" ${eff.type} 的 from 端把目标 "${b.target}" 推到完全画布外` +
                `(目标画在 ${axis}≈${lo},from:${eff.from} → ${axis}≈${lo + (eff.from as number)},viewBox ${axis} 范围 ${vlo}..${vhi})。` +
                `translate 是相对位移;若你想表达绝对位置,删掉 from/to,改写 ${absK}:${eff.from} / ${absK2}:${eff.to}(数值原样搬,工具自动换算)`)
            } else if (toState === 'out') {
              warnings.push(`${tag}: binding "${b.variable}" ${eff.type} 的 to 端把目标完全推出 viewBox——若非有意退场动画,检查是否把绝对坐标写成了相对位移(可改用 ${absK}/${absK2})`)
            } else if (fromState === 'partial' || toState === 'partial') {
              warnings.push(`${tag}: binding "${b.variable}" ${eff.type} 某端目标过半出 viewBox,检查 from/to 是否误为绝对坐标(可改用 ${absK}/${absK2})`)
            }
          }
        }
      }
    }
  }

  for (const [id, owners] of customIds) {
    if (owners.length > 1) warnings.push(`custom id "${id}" is shared by parts ${owners.map((o) => `"${o}"`).join(', ')} — global collision risk; prefix ids with part.id`)
  }

  if (spec.version === '2') validateV2Extra(spec, ids, known, errors, warnings)

  return { ok: errors.length === 0, errors, warnings }
}

// ── svg 静态几何(供几何门 / 绝对坐标 lowering 共用)──────────────────────────
// 启发式标签扫描器:只认 rect/circle/ellipse/line 的字面属性;path/text/transform/
// 嵌套运动绑定等不可静态推演的情形显式 bail(由调用方决定静默跳过或报错)。

export interface ViewBox { x: number; y: number; w: number; h: number }

export function viewBoxOf(svg: string): ViewBox | null {
  const vb = svg.match(/viewBox\s*=\s*['"]\s*([-\d.]+)[ ,]+([-\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)\s*['"]/i)
  if (vb) return { x: +vb[1], y: +vb[2], w: +vb[3], h: +vb[4] }
  const w = svg.match(/<svg[^>]*\bwidth\s*=\s*['"]([\d.]+)/i)
  const h = svg.match(/<svg[^>]*\bheight\s*=\s*['"]([\d.]+)/i)
  if (w && h) return { x: 0, y: 0, w: +w[1], h: +h[1] }
  return null
}

// 嵌套 <svg> 只有 viewBox、没 width/height 时会默认 100% 撑满外层画布,导致 custom 件
// 渲染膨胀、溢出/重叠。给根 <svg> 补 width/height = viewBox 宽高,使其按意图尺寸渲染
// (嵌套 svg 默认 overflow:hidden 还会把越界内容裁回该框)。已有 width/height 则不动。
export function sizeCustomSvg(svg: string): string {
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

export type TargetGeom =
  | { ok: true; minX: number; minY: number; maxX: number; maxY: number }
  | { ok: false; reason: string }

const GEOM_BAIL_TAGS = new Set(['path', 'polygon', 'polyline', 'text', 'use', 'image', 'foreignobject'])

export function svgTargetGeometry(svg: string, targetId: string, otherBoundIds?: Set<string>): TargetGeom {
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:[^>'"]|'[^']*'|"[^"]*")*?)(\/?)>/g
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:'([^']*)'|"([^"]*)")/g
  const stack: Array<{ id?: string; transform: boolean }> = []
  let inTarget = false, targetDepth = 0, found = false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const acc = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0); minY = Math.min(minY, y0); maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1)
  }
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(svg))) {
    const close = m[1] === '/', tag = m[2].toLowerCase(), selfClose = m[4] === '/'
    if (close) {
      stack.pop()
      if (inTarget && stack.length === targetDepth) { inTarget = false; break }
      continue
    }
    const attrs: Record<string, string> = {}
    for (const a of m[3].matchAll(attrRe)) attrs[a[1].toLowerCase()] = a[2] ?? a[3]
    const num = (k: string, dflt?: number): number | null => {
      const v = attrs[k] != null ? Number(attrs[k]) : dflt
      return v != null && Number.isFinite(v) ? v : null
    }
    const entering = !inTarget && attrs.id === targetId
    if (entering) {
      found = true
      for (const anc of stack) {
        if (anc.transform) return { ok: false, reason: '祖先元素带 transform,静态位置不可判' }
        if (anc.id && otherBoundIds?.has(anc.id)) return { ok: false, reason: `祖先 "${anc.id}" 是另一运动绑定的目标,位置由运行时 transform 决定` }
      }
      if (attrs.transform) return { ok: false, reason: '目标元素自带 transform,静态位置不可判' }
      inTarget = true
      targetDepth = stack.length
    }
    if (inTarget) {
      if (GEOM_BAIL_TAGS.has(tag)) return { ok: false, reason: `子树含 <${tag}>,bbox 不可静态推算` }
      if (!entering && attrs.transform) return { ok: false, reason: '子元素带 transform,静态位置不可判' }
      if (tag === 'rect') {
        const x = num('x', 0)!, y = num('y', 0)!, w = num('width'), h = num('height')
        if (w == null || h == null) return { ok: false, reason: 'rect 缺数字 width/height' }
        acc(x, y, x + w, y + h)
      } else if (tag === 'circle') {
        const cx = num('cx', 0)!, cy = num('cy', 0)!, r = num('r')
        if (r == null) return { ok: false, reason: 'circle 缺数字 r' }
        acc(cx - r, cy - r, cx + r, cy + r)
      } else if (tag === 'ellipse') {
        const cx = num('cx', 0)!, cy = num('cy', 0)!, rx = num('rx'), ry = num('ry')
        if (rx == null || ry == null) return { ok: false, reason: 'ellipse 缺数字 rx/ry' }
        acc(cx - rx, cy - ry, cx + rx, cy + ry)
      } else if (tag === 'line') {
        const x1 = num('x1', 0)!, y1 = num('y1', 0)!, x2 = num('x2', 0)!, y2 = num('y2', 0)!
        acc(Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2))
      }
      if (entering && selfClose) break          // 目标本身自闭合,采完即止
    }
    if (!selfClose) stack.push({ id: attrs.id, transform: !!attrs.transform })
  }
  if (!found) return { ok: false, reason: `svg 中找不到 id="${targetId}"` }
  if (minX === Infinity) return { ok: false, reason: '目标内无可测量几何元素(rect/circle/ellipse/line)' }
  return { ok: true, minX, minY, maxX, maxY }
}

// ── 绝对坐标 lowering(buildSimulation 在 validate 之前调用)──────────────────
// agent 按"把元素移到哪"的绝对心智写 xFrom/xTo(translateX)/ yFrom/yTo(translateY),
// 这里按 target 静态 bbox 左/顶边换算成渲染器的相对 from/to。原绝对字段保留为惰性元数据。
// 副作用:就地向 spec 中每条命中的 effect 对象写入 from/to(不返回新 spec,调用方继续用原对象)。
export function lowerAbsoluteTranslate(spec: SceneSpec): { errors: string[]; notes: string[] } {
  const errors: string[] = [], notes: string[] = []
  if (!Array.isArray(spec?.parts)) return { errors, notes }
  for (const p of spec.parts) {
    const tag = `part "${(p as { id?: string })?.id ?? '?'}"`
    const bindings = Array.isArray((p as { bindings?: unknown })?.bindings) ? (p.bindings as Array<Record<string, any>>) : []
    const translateTargets = new Set<string>()
    for (const b of bindings) {
      const ty = b?.effect?.type
      if (b?.target && (ty === 'translateX' || ty === 'translateY' || ty === 'translateAlong')) translateTargets.add(b.target)
    }
    for (const b of bindings) {
      const eff = b?.effect
      if (!eff || typeof eff !== 'object') continue
      const isX = eff.type === 'translateX', isY = eff.type === 'translateY'
      const hasXAbs = eff.xFrom != null || eff.xTo != null
      const hasYAbs = eff.yFrom != null || eff.yTo != null
      if (!hasXAbs && !hasYAbs) continue
      const bn = `${tag}: binding "${b?.variable ?? '?'}"`
      if (!isX && !isY) { errors.push(`${bn}: ${String(eff.type)} 不支持绝对坐标字段(仅 translateX/translateY)`); continue }
      if (isX && hasYAbs) { errors.push(`${bn}: translateX 的绝对字段是 xFrom/xTo,不是 yFrom/yTo`); continue }
      if (isY && hasXAbs) { errors.push(`${bn}: translateY 的绝对字段是 yFrom/yTo,不是 xFrom/xTo`); continue }
      const aFrom = isX ? eff.xFrom : eff.yFrom, aTo = isX ? eff.xTo : eff.yTo
      const k = isX ? 'xFrom/xTo' : 'yFrom/yTo'
      if (typeof aFrom !== 'number' || typeof aTo !== 'number') { errors.push(`${bn}: ${k} 必须成对给出数字`); continue }
      if (typeof eff.from === 'number' || typeof eff.to === 'number') {
        errors.push(`${bn}: 不要同时给 from/to(相对位移) 和 ${k}(绝对坐标)——保留 ${k} 删掉 from/to,或反之`); continue
      }
      if ((p as { kind?: string }).kind !== 'custom' || typeof (p as { svg?: string }).svg !== 'string' || !b.target) {
        errors.push(`${bn}: 绝对坐标字段仅支持 custom 部件内带 target 的绑定`); continue
      }
      const others = new Set(translateTargets); others.delete(b.target)
      const g = svgTargetGeometry((p as { svg: string }).svg, b.target, others)
      if (!g.ok) { errors.push(`${bn}: 无法确定目标 "${b.target}" 的绘制位置(${g.reason})——请把目标简化为 rect/g-of-rects,或改用相对 from/to`); continue }
      const base = isX ? g.minX : g.minY
      eff.from = aFrom - base
      eff.to = aTo - base
      notes.push(`${bn}: 绝对 ${k}(${aFrom}→${aTo}) 已按目标绘制位置(${isX ? 'x' : 'y'}≈${base})换算为相对 from:${eff.from}/to:${eff.to}`)
    }
  }
  return { errors, notes }
}
