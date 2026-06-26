import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveProject } from '../../src/tools/resolveProject.js'

function ws(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'))
  fs.mkdirSync(path.join(d, 'src', 'programs'), { recursive: true })
  return d
}
const FB = 'FUNCTION_BLOCK Adder\n VAR_INPUT a:INT; END_VAR\n VAR_OUTPUT s:INT; END_VAR\n s:=a+1;\nEND_FUNCTION_BLOCK'
const PROG = 'PROGRAM main\n VAR o AT %QW0:INT; END_VAR\n VAR add:Adder; END_VAR\n add(a:=5); o:=add.s;\nEND_PROGRAM'
const CFG = 'CONFIGURATION Config0\n RESOURCE Res0 ON PLC\n TASK Main(INTERVAL:=T#20ms,PRIORITY:=0);\n PROGRAM Inst0 WITH Main : main;\n END_RESOURCE\nEND_CONFIGURATION'

describe('resolveProject', () => {
  it('single stCode delegates to resolveStInput (combine null)', () => {
    const r = resolveProject({ stCode: 'PROGRAM p END_PROGRAM' }, {})
    expect(r.stCode).toBe('PROGRAM p END_PROGRAM')
    expect(r.combine).toBeNull()
    expect(r.error).toBeNull()
  })
  it('stPaths merges files in given order into one compilation unit', () => {
    const d = ws()
    fs.writeFileSync(path.join(d, 'src/programs/fb.st'), FB)
    fs.writeFileSync(path.join(d, 'src/programs/main.st'), PROG)
    fs.writeFileSync(path.join(d, 'src/programs/cfg.st'), CFG)
    const r = resolveProject({ stPaths: ['src/programs/fb.st', 'src/programs/main.st', 'src/programs/cfg.st'] }, { workspace: d })
    expect(r.error).toBeNull()
    expect(r.combine!.ok).toBe(true)
    expect(r.stCode).toContain('FUNCTION_BLOCK Adder')
    expect(r.stCode).toContain('PROGRAM main')
    expect(r.entryPath).toBe('src/programs/cfg.st')
  })
  it('projectDir collects single-level *.st', () => {
    const d = ws()
    fs.writeFileSync(path.join(d, 'src/programs/fb.st'), FB)
    fs.writeFileSync(path.join(d, 'src/programs/main.st'), PROG)
    fs.writeFileSync(path.join(d, 'src/programs/cfg.st'), CFG)
    const r = resolveProject({ projectDir: 'src/programs' }, { workspace: d })
    expect(r.error).toBeNull()
    expect(r.combine!.ok).toBe(true)
  })
  it('combine failure (no CONFIGURATION) surfaces as error, stCode null', () => {
    const d = ws()
    fs.writeFileSync(path.join(d, 'src/programs/fb.st'), FB)
    fs.writeFileSync(path.join(d, 'src/programs/main.st'), PROG)
    const r = resolveProject({ stPaths: ['src/programs/fb.st', 'src/programs/main.st'] }, { workspace: d })
    expect(r.stCode).toBeNull()
    expect(r.error).toMatch(/CONFIGURATION/)
  })
  it('rejects a stPaths element escaping the workspace', () => {
    const d = ws()
    const r = resolveProject({ stPaths: ['../../etc/passwd'] }, { workspace: d })
    expect(r.error).toMatch(/越出工作区|escapes/)
  })
  it('errors on a missing file', () => {
    const d = ws()
    const r = resolveProject({ stPaths: ['src/programs/nope.st'] }, { workspace: d })
    expect(r.error).toMatch(/读取|ENOENT|失败/)
  })
})
