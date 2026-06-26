import type { Effect, ValueMatch } from '../../../shared/protocol'

export type EffectPatch =
  | { kind: 'fill'; color: string | null }
  | { kind: 'visible'; hidden: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'transform'; transform: string }
  | { kind: 'attr'; name: 'width' | 'height'; value: number }
  | { kind: 'opacity'; value: number }
  | { kind: 'class'; className: string }

type V = number | boolean | string

function asNum(v: V): number {
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function matchValue(m: ValueMatch, value: V): boolean {
  const n = asNum(value)
  if ('eq' in m) return typeof m.eq === 'boolean' ? (n !== 0) === m.eq : n === m.eq
  if ('gte' in m) return n >= m.gte && (m.lt == null || n < m.lt)
  if ('truthy' in m) return n !== 0
  return false
}

function lerp(value: number, valueFrom: number, valueTo: number, from: number, to: number): number {
  if (valueTo === valueFrom) return from
  const t = Math.max(0, Math.min(1, (value - valueFrom) / (valueTo - valueFrom)))
  return from + t * (to - from)
}

// Map an effect + the current variable value to a presentation patch. Pure: the
// SimRuntime applies the patch to a DOM element. This is the heart of animation.
export function resolveEffect(effect: Effect, value: V): EffectPatch {
  const n = asNum(value)
  switch (effect.type) {
    case 'fill': {
      const hit = effect.map.find((r) => matchValue(r.when, value))
      return { kind: 'fill', color: hit ? hit.color : null }
    }
    case 'visible':
      return { kind: 'visible', hidden: !matchValue(effect.when, value) }
    case 'text': {
      let v = String(value)
      if (typeof value === 'number' && effect.decimals != null) v = value.toFixed(effect.decimals)
      const formatted = effect.format ? effect.format.replaceAll('{v}', v) : v
      return { kind: 'text', text: effect.suffix ? `${formatted}${effect.suffix}` : formatted }
    }
    case 'translateX':
      return { kind: 'transform', transform: `translate(${lerp(n, effect.valueFrom, effect.valueTo, effect.from, effect.to)},0)` }
    case 'translateY':
      return { kind: 'transform', transform: `translate(0,${lerp(n, effect.valueFrom, effect.valueTo, effect.from, effect.to)})` }
    case 'width':
    case 'height':
      return { kind: 'attr', name: effect.type, value: lerp(n, effect.valueFrom, effect.valueTo, effect.from, effect.to) }
    case 'opacity':
      return { kind: 'opacity', value: lerp(n, effect.valueFrom, effect.valueTo, effect.from, effect.to) }
    case 'rotate':
      return { kind: 'transform', transform: `rotate(${n * (effect.degPerUnit ?? 1)})` }
    case 'class': {
      const hit = effect.map.find((r) => matchValue(r.when, value))
      return { kind: 'class', className: hit ? hit.className : '' }
    }
    // translateAlong is resolved by SimRuntime via resolveLayout/alongPosition, not here.
    case 'translateAlong':
      return { kind: 'transform', transform: '' }
  }
}

// Apply a patch to a DOM element. Thin glue over setAttribute / style / textContent.
export function applyPatch(el: Element, patch: EffectPatch): void {
  switch (patch.kind) {
    case 'fill':
      if (patch.color != null) el.setAttribute('fill', patch.color)
      break
    case 'visible':
      ;(el as HTMLElement).style.display = patch.hidden ? 'none' : ''
      break
    case 'text':
      el.textContent = patch.text
      break
    case 'transform':
      el.setAttribute('transform', patch.transform)
      break
    case 'attr':
      el.setAttribute(patch.name, String(patch.value))
      break
    case 'opacity':
      ;(el as HTMLElement).style.opacity = String(patch.value)
      break
    case 'class': {
      const base = el.getAttribute('data-base-class') ?? ''
      el.setAttribute('class', `${base} ${patch.className}`.trim())
      break
    }
  }
}
