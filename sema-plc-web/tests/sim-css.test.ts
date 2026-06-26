import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CSS = fs.readFileSync(path.join(here, '../src/components/sim/sim-runtime.css'), 'utf8')

describe('sim-runtime.css transition (500ms jitter masking)', () => {
  it('adds a transition on [data-anchor] for transform/width/height/fill', () => {
    const rule = CSS.split('\n').find((l) => l.includes('[data-anchor]') && l.includes('transition'))
    expect(rule, 'a [data-anchor] transition rule').toBeTruthy()
    expect(rule).toMatch(/transform/)
    expect(rule).toMatch(/fill/)
  })
  it('keeps the sim-run keyframe animations intact (orthogonal to transition)', () => {
    expect(CSS).toMatch(/\.sim-rotor\.sim-run\s*\{[^}]*animation/)
    expect(CSS).toMatch(/\.sim-belt\.sim-run\s*\{[^}]*animation/)
  })
})
