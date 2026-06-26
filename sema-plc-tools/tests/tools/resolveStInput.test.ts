import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveStInput } from '../../src/tools/resolveStInput.js'

function tmpWs(): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'rsi-'))
  fs.mkdirSync(path.join(ws, 'src', 'programs'), { recursive: true })
  return ws
}

describe('resolveStInput', () => {
  it('returns stCode when only stCode given', () => {
    const r = resolveStInput({ stCode: 'PROGRAM p END_PROGRAM' }, {})
    expect(r).toEqual({ stCode: 'PROGRAM p END_PROGRAM', bothGiven: false, error: null })
  })
  it('reads a relative stPath against cfg.workspace', () => {
    const ws = tmpWs()
    fs.writeFileSync(path.join(ws, 'src/programs/a.st'), 'PROGRAM a END_PROGRAM')
    const r = resolveStInput({ stPath: 'src/programs/a.st' }, { workspace: ws })
    expect(r.error).toBeNull()
    expect(r.stCode).toBe('PROGRAM a END_PROGRAM')
  })
  it('reads an absolute stPath inside the workspace', () => {
    const ws = tmpWs()
    const abs = path.join(ws, 'src/programs/b.st')
    fs.writeFileSync(abs, 'PROGRAM b END_PROGRAM')
    expect(resolveStInput({ stPath: abs }, { workspace: ws }).stCode).toBe('PROGRAM b END_PROGRAM')
  })
  it('bothGiven=true when stCode and stPath both supplied (stPath wins)', () => {
    const ws = tmpWs()
    fs.writeFileSync(path.join(ws, 'src/programs/c.st'), 'FROM_FILE')
    const r = resolveStInput({ stCode: 'INLINE', stPath: 'src/programs/c.st' }, { workspace: ws })
    expect(r.stCode).toBe('FROM_FILE')
    expect(r.bothGiven).toBe(true)
  })
  it('rejects ../ traversal outside the workspace', () => {
    const ws = tmpWs()
    const r = resolveStInput({ stPath: '../../etc/passwd' }, { workspace: ws })
    expect(r.stCode).toBeNull()
    expect(r.error).toMatch(/越出工作区|escapes/)
  })
  it('rejects an absolute stPath outside the workspace', () => {
    const ws = tmpWs()
    const r = resolveStInput({ stPath: '/etc/hosts' }, { workspace: ws })
    expect(r.error).toMatch(/越出工作区|escapes/)
  })
  it('errors when the file is missing', () => {
    const ws = tmpWs()
    expect(resolveStInput({ stPath: 'src/programs/nope.st' }, { workspace: ws }).error).toMatch(/读取 stPath 失败|ENOENT|failed/)
  })
  it('errors when neither stCode nor stPath given', () => {
    expect(resolveStInput({}, {}).error).toMatch(/stCode|stPath/)
  })
  it('without cfg.workspace, resolves relative to cwd and does not enforce containment', () => {
    const ws = tmpWs()
    const abs = path.join(ws, 'src/programs/d.st')
    fs.writeFileSync(abs, 'PROGRAM d END_PROGRAM')
    expect(resolveStInput({ stPath: abs }, {}).stCode).toBe('PROGRAM d END_PROGRAM')
  })
})
