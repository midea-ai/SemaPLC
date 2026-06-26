import { parse } from 'yaml'
import type { DetectedIO } from '../types.js'

export interface IoMapEntry { component?: string; label?: string }
export type IoMap = Record<string, IoMapEntry>

// Parse an io_map.yaml. Tolerant: empty / invalid / non-object yaml → {} (the
// hint layer is optional, never fatal). Entries are keyed by ST symbol name.
export function parseIoMap(yamlText: string): IoMap {
  if (!yamlText || !yamlText.trim()) return {}
  let doc: unknown
  try { doc = parse(yamlText) } catch { return {} }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return {}
  const out: IoMap = {}
  for (const [k, v] of Object.entries(doc as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const e = v as Record<string, unknown>
      const entry: IoMapEntry = {}
      if (typeof e.component === 'string') entry.component = e.component
      if (typeof e.label === 'string') entry.label = e.label
      out[k] = entry
    }
  }
  return out
}

// Apply io_map hints onto detected IO: fill `component` where the map provides
// one. Pure — returns a new array, never mutates the input.
export function applyIoMap(io: DetectedIO[], map: IoMap): DetectedIO[] {
  return io.map((e) => {
    const hint = map[e.name]
    return hint?.component ? { ...e, component: hint.component } : e
  })
}
