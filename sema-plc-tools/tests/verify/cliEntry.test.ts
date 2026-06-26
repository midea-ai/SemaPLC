import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { loadCfgFromMcpJson, registerForces, unregisterForces, activeForcesPath, ledgerFiles } from '../../src/verify/cliEntry.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plc-cli-entry-'))
}

describe('loadCfgFromMcpJson', () => {
  afterEach(() => {
    delete process.env.PLC_STATE_FILE
  })

  it('.sema/.mcp.json 的 env block 落到 cfg(未设进程 env 时)', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, '.sema'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.sema', '.mcp.json'), JSON.stringify({
      mcpServers: { 'plc-tools': { env: { PLC_STATE_FILE: '/tmp/x.json' } } },
    }))
    delete process.env.PLC_STATE_FILE
    const cfg = loadCfgFromMcpJson(dir)
    expect(cfg.stateFile).toBe('/tmp/x.json')
  })

  it('已设的进程 env 优先于 .mcp.json', () => {
    const dir = tmpDir()
    fs.mkdirSync(path.join(dir, '.sema'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.sema', '.mcp.json'), JSON.stringify({
      mcpServers: { 'plc-tools': { env: { PLC_STATE_FILE: '/tmp/x.json' } } },
    }))
    process.env.PLC_STATE_FILE = '/keep'
    const cfg = loadCfgFromMcpJson(dir)
    expect(cfg.stateFile).toBe('/keep')
  })

  it('无 .mcp.json(headless)→ 不抛、用默认', () => {
    delete process.env.PLC_STATE_FILE
    const dir = tmpDir()
    const cfg = loadCfgFromMcpJson(dir)
    expect(cfg.stateFile).toContain('state.json')
  })
})

describe('register/unregister forces 持久化(SIGKILL-safe 台账)', () => {
  it('register 并集、unregister 差集,落盘 active-forces.json', () => {
    const ws = tmpDir()
    registerForces(ws, ['a', 'b'])
    const p = activeForcesPath(ws)
    expect(p).toBe(path.join(ws, '.plc-act', 'active-forces.json'))
    expect(new Set(JSON.parse(fs.readFileSync(p, 'utf8')))).toEqual(new Set(['a', 'b']))

    registerForces(ws, ['b', 'c'])
    expect(new Set(JSON.parse(fs.readFileSync(p, 'utf8')))).toEqual(new Set(['a', 'b', 'c']))

    unregisterForces(ws, ['b'])
    expect(new Set(JSON.parse(fs.readFileSync(p, 'utf8')))).toEqual(new Set(['a', 'c']))
  })

  it('台账文件损坏时 register 容错(视为空)', () => {
    const ws = tmpDir()
    fs.mkdirSync(path.join(ws, '.plc-act'), { recursive: true })
    fs.writeFileSync(activeForcesPath(ws), 'not json{{')
    registerForces(ws, ['x'])
    expect(JSON.parse(fs.readFileSync(activeForcesPath(ws), 'utf8'))).toEqual(['x'])
  })

  it('id 变体落盘到 active-forces.<id>.json,与 legacy 文件互不干扰', () => {
    const ws = tmpDir()
    registerForces(ws, ['s'])            // serial → active-forces.json
    registerForces(ws, ['a'], 1)         // 实例 1 → active-forces.1.json
    registerForces(ws, ['b'], 2)         // 实例 2 → active-forces.2.json
    expect(activeForcesPath(ws, 1)).toBe(path.join(ws, '.plc-act', 'active-forces.1.json'))
    expect(JSON.parse(fs.readFileSync(activeForcesPath(ws, 1), 'utf8'))).toEqual(['a'])
    expect(JSON.parse(fs.readFileSync(activeForcesPath(ws, 2), 'utf8'))).toEqual(['b'])
    expect(JSON.parse(fs.readFileSync(activeForcesPath(ws), 'utf8'))).toEqual(['s'])
    // unregister 只动本文件
    unregisterForces(ws, ['a'], 1)
    expect(JSON.parse(fs.readFileSync(activeForcesPath(ws, 1), 'utf8'))).toEqual([])
    expect(JSON.parse(fs.readFileSync(activeForcesPath(ws, 2), 'utf8'))).toEqual(['b'])
  })
})

describe('ledgerFiles —— 列出 legacy + per-instance 台账', () => {
  it('解析 id(legacy=null / <id>=number)并读出 names', () => {
    const ws = tmpDir()
    registerForces(ws, ['leg'])          // active-forces.json → id=null
    registerForces(ws, ['x', 'y'], 1)    // active-forces.1.json → id=1
    registerForces(ws, ['z'], 3)         // active-forces.3.json → id=3
    const got = ledgerFiles(ws).sort((a, b) => (a.id ?? -1) - (b.id ?? -1))
    expect(got.map(g => g.id)).toEqual([null, 1, 3])
    expect(got.find(g => g.id === null)!.names).toEqual(['leg'])
    expect(new Set(got.find(g => g.id === 1)!.names)).toEqual(new Set(['x', 'y']))
    expect(got.find(g => g.id === 3)!.names).toEqual(['z'])
  })

  it('.plc-act 不存在 → 返回空', () => {
    expect(ledgerFiles(tmpDir())).toEqual([])
  })
})
