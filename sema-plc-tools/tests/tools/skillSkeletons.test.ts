import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { validateSceneSpec } from '../../src/tools/sceneSpec.js'
import { PART_KINDS, PART_BOXES } from '../../src/tools/partsCatalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(here, '../../..')
const SKILL = fs.readFileSync(
  path.join(REPO, 'sema-plc-web/templates/.sema/skills/plc-build-simulation/SKILL.md'), 'utf8')

// mirrors SimRuntime.tsx sanitizeSvg
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
}

function svgBlocks(md: string): string[] {
  return [...md.matchAll(/```svg\n([\s\S]*?)```/g)].map((m) => m[1])
}

describe('SKILL.md custom skeletons', () => {
  const blocks = svgBlocks(SKILL)

  it('contains at least 3 svg skeleton blocks', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(3)
  })
  it('every skeleton uses part.id-prefixed binding ids and def- prefixed defs', () => {
    for (const b of blocks) {
      expect(b).not.toMatch(/\bid=['"](belt|door|__BIND__)['"]/)
      for (const m of b.matchAll(/url\(#([^)]+)\)/g)) expect(m[1]).toMatch(/^def-/)
    }
  })
  it('no skeleton contains a <style> block (global leak)', () => {
    for (const b of blocks) expect(b).not.toMatch(/<\s*style/i)
  })
  it('sanitizeSvg preserves binding ids / data-anchor / def refs / dasharray / transform', () => {
    for (const b of blocks) {
      const out = sanitizeSvg(b)
      for (const m of b.matchAll(/\bid=['"]([^'"]+)['"]/g)) expect(out).toContain(`id="${m[1]}"`)
      if (/data-anchor/.test(b)) expect(out).toMatch(/data-anchor/)
      if (/stroke-dasharray/.test(b)) expect(out).toMatch(/stroke-dasharray/)
      if (/url\(#def-/.test(b)) expect(out).toMatch(/url\(#def-/)
      if (/\btransform=/.test(b)) expect(out).toMatch(/transform=/)
    }
  })
  it('each skeleton wrapped as a custom part passes validateSceneSpec', () => {
    for (const b of blocks) {
      const scene = { version: '1' as const, canvas: { width: 800, height: 450 },
        parts: [{ id: 'sk', kind: 'custom', x: 0, y: 0, svg: b, bindings: [] }] }
      const r = validateSceneSpec(scene, [], { partKinds: PART_KINDS, partBoxes: PART_BOXES })
      expect(r.errors, `skeleton errors: ${r.errors.join('; ')}`).toEqual([])
    }
  })
})
