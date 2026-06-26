import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { PART_KINDS } from '../../src/tools/partsCatalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(here, '../../..')   // research/
const FRONTEND_CATALOG = path.join(REPO, 'sema-plc-web/src/components/sim/partsCatalog.ts')
const SKILL_MD = path.join(REPO, 'sema-plc-web/templates/.sema/skills/plc-build-simulation/SKILL.md')

function frontendKinds(src: string): Set<string> {
  return new Set([...src.matchAll(/\bkind:\s*'([^']+)'/g)].map((m) => m[1]))
}
// SKILL.md 部件库 section bullets: `- \`xxx\` — …`(— 为 U+2014 em dash)
function skillKinds(md: string): Set<string> {
  const section = md.split('## 部件库')[1]?.split('\n## ')[0] ?? ''
  return new Set([...section.matchAll(/^- `([^`]+)`\s+—/gm)].map((m) => m[1]))
}

describe('catalog source-of-truth sync', () => {
  it('plc-tools PART_KINDS == frontend partsCatalog kinds', () => {
    const fe = frontendKinds(fs.readFileSync(FRONTEND_CATALOG, 'utf8'))
    expect([...PART_KINDS].sort()).toEqual([...fe].sort())
  })
  it('SKILL.md kind bullets == PART_KINDS', () => {
    const sk = skillKinds(fs.readFileSync(SKILL_MD, 'utf8'))
    expect([...sk].sort()).toEqual([...PART_KINDS].sort())
  })
})
