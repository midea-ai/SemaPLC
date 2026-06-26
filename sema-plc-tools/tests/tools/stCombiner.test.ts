import { describe, it, expect } from 'vitest'
import { stripComments } from '../../src/tools/stCombiner.js'
import { parseUnits } from '../../src/tools/stCombiner.js'
import * as fs from 'fs'

describe('stripComments', () => {
  it('blanks a block comment but keeps length and newlines', () => {
    const src = 'A(* x\ny *)B'
    const out = stripComments(src)
    expect(out.length).toBe(src.length)         // length-preserving (positions stable)
    expect(out).toBe('A    \n    B')            // comment chars → spaces, newline kept
    expect(out).not.toMatch(/x|y/)
  })
  it('blanks a line comment to end of line', () => {
    expect(stripComments('a // END_PROGRAM\nb')).toBe('a               \nb')
  })
  it('blanks string-literal contents (no keyword leakage)', () => {
    const out = stripComments("s := 'END_PROGRAM';")
    expect(out).toMatch(/^s := '\s+';$/)
    expect(out).not.toContain('END_PROGRAM')
  })
  it('leaves real code untouched', () => {
    expect(stripComments('END_PROGRAM')).toBe('END_PROGRAM')
  })
})

describe('parseUnits', () => {
  it('chunks FUNCTION adjacent to FUNCTION_BLOCK (longest-match END)', () => {
    const { units, errors } = parseUnits([{ path: 'a.st', content:
      'FUNCTION f : INT\n f := 1;\nEND_FUNCTION\nFUNCTION_BLOCK fb\n y := 2;\nEND_FUNCTION_BLOCK' }])
    expect(errors).toEqual([])
    expect(units.map(u => u.kind)).toEqual(['FUNCTION', 'FUNCTION_BLOCK'])
  })
  it('treats PROGRAM inside CONFIGURATION as part of the CONFIGURATION block', () => {
    const { units } = parseUnits([{ path: 'm.st', content:
      'PROGRAM main\n x:=1;\nEND_PROGRAM\nCONFIGURATION C\n RESOURCE R ON PLC\n PROGRAM Inst0 WITH T : main;\n END_RESOURCE\nEND_CONFIGURATION' }])
    expect(units.map(u => u.kind)).toEqual(['PROGRAM', 'CONFIGURATION'])
  })
  it('ignores fake keywords in comments/strings', () => {
    const { units } = parseUnits([{ path: 'c.st', content:
      'PROGRAM p\n (* END_PROGRAM fake *)\n s := \'CONFIGURATION x\';\nEND_PROGRAM' }])
    expect(units.map(u => u.kind)).toEqual(['PROGRAM'])
  })
  it('fail-safe: an opener with no matching END produces an error (no silent mis-chunk)', () => {
    const { errors } = parseUnits([{ path: 'bad.st', content: 'PROGRAM oops\n x:=1;' }])
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toMatch(/END_PROGRAM|bad\.st/)
  })
  it('records kind, path and 1-based localStartLine', () => {
    const { units } = parseUnits([{ path: 'x.st', content: '\nFUNCTION_BLOCK fb\n y:=1;\nEND_FUNCTION_BLOCK' }])
    expect(units[0]).toMatchObject({ path: 'x.st', kind: 'FUNCTION_BLOCK', localStartLine: 2 })
  })
  it('all bundled runtime samples chunk without error', () => {
    const dir = 'runtime/samples'
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.st')).map(f => `${dir}/${f}`)
    let broken = []
    for (const f of files) {
      const { errors } = parseUnits([{ path: f, content: fs.readFileSync(f, 'utf8') }])
      if (errors.length) broken.push(f.split('/').pop())
    }
    expect(broken).toEqual([])
  })
})

import { combineUnits, translateErrorLine } from '../../src/tools/stCombiner.js'

const FB = { path: 'fb.st', content: 'FUNCTION_BLOCK Adder\n VAR_INPUT a:INT; END_VAR\n VAR_OUTPUT s:INT; END_VAR\n s := a + 1;\nEND_FUNCTION_BLOCK' }
const PROG = { path: 'main.st', content: 'PROGRAM main\n VAR o AT %QW0 : INT; END_VAR\n VAR add : Adder; END_VAR\n add(a:=5); o := add.s;\nEND_PROGRAM' }
const CFG = { path: 'cfg.st', content: 'CONFIGURATION Config0\n RESOURCE Res0 ON PLC\n TASK Main(INTERVAL:=T#20ms,PRIORITY:=0);\n PROGRAM Inst0 WITH Main : main;\n END_RESOURCE\nEND_CONFIGURATION' }

describe('combineUnits', () => {
  it('layers FB before PROGRAM before CONFIGURATION and reports entry', () => {
    const r = combineUnits(parseUnits([PROG, FB, CFG]))     // deliberately scrambled input order
    expect(r.ok).toBe(true)
    const iFb = r.combined.indexOf('FUNCTION_BLOCK Adder')
    const iProg = r.combined.indexOf('PROGRAM main')
    const iCfg = r.combined.indexOf('CONFIGURATION Config0')
    expect(iFb).toBeLessThan(iProg)
    expect(iProg).toBeLessThan(iCfg)
    expect(r.entryPath).toBe('cfg.st')
  })
  it('errors when there is no CONFIGURATION', () => {
    const r = combineUnits(parseUnits([FB, PROG]))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/CONFIGURATION/)
  })
  it('errors on multiple PROGRAMs (SPIKE-2 single-PROGRAM constraint)', () => {
    const P2 = { path: 'p2.st', content: 'PROGRAM other\n x:=1;\nEND_PROGRAM' }
    const r = combineUnits(parseUnits([PROG, P2, CFG]))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/PROGRAM/)
  })
  it('propagates parse errors and refuses to combine', () => {
    const r = combineUnits(parseUnits([{ path: 'bad.st', content: 'PROGRAM x\n y:=1;' }, CFG]))
    expect(r.ok).toBe(false)
    expect(r.combined).toBeNull()
  })
  it('spans map a merged line back to source file + local line', () => {
    const r = combineUnits(parseUnits([FB, PROG, CFG]))
    // find the merged line number of "s := a + 1;" (inside Adder)
    const lines = r.combined.split('\n')
    const mLine = lines.findIndex(l => l.includes('s := a + 1;')) + 1
    const t = translateErrorLine(mLine, r.spans)
    expect(t).toEqual({ path: 'fb.st', localLine: 4 })
  })
})
