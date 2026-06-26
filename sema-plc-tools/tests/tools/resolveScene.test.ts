import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { resolveScene } from '../../src/tools/resolveProject.js'

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scene-'))
}

describe('resolveScene', () => {
  it('reads and JSON-parses a workspace-relative scene file', () => {
    const d = ws()
    const scene = { version: '1', canvas: { width: 800, height: 600 }, parts: [] }
    fs.writeFileSync(path.join(d, 'scene.json'), JSON.stringify(scene))
    const r = resolveScene('scene.json', { workspace: d })
    expect(r.error).toBeNull()
    expect(r.scene).toEqual(scene)
  })

  it('rejects a scenePath escaping the workspace (../../)', () => {
    const d = ws()
    const r = resolveScene('../../etc/passwd', { workspace: d })
    expect(r.scene).toBeNull()
    expect(r.error).toMatch(/越出工作区|escapes/)
  })

  it('errors on a missing file', () => {
    const d = ws()
    const r = resolveScene('nope.json', { workspace: d })
    expect(r.scene).toBeNull()
    expect(r.error).toMatch(/读取|ENOENT|失败/)
  })

  it('errors on invalid JSON', () => {
    const d = ws()
    fs.writeFileSync(path.join(d, 'bad.json'), '{ not json')
    const r = resolveScene('bad.json', { workspace: d })
    expect(r.scene).toBeNull()
    expect(r.error).toMatch(/JSON|解析/)
  })
})
