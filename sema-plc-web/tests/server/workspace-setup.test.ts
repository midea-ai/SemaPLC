import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { safePath } from '../../server/pathSafety.js'
import {
  setupWorkspaceIfNeeded,
  reconcileMcpModbusPort,
  scanStFiles,
  readStFile,
  writeStFile,
  resolvePlcToolsCli,
  substituteTokens,
  checkWorkspaceTarget,
} from '../../server/workspace-setup.js'

const TMP_WS = path.join(os.tmpdir(), `plc-vis-ws-test-${Date.now()}-${randomUUID()}`)

beforeEach(() => {
  fs.rmSync(TMP_WS, { recursive: true, force: true })
})
afterEach(() => {
  fs.rmSync(TMP_WS, { recursive: true, force: true })
})

describe('setupWorkspaceIfNeeded', () => {
  it('creates .plc-vis/ and .sema/.mcp.json (with __WORKSPACE__ substituted) on a fresh workspace', () => {
    const r = setupWorkspaceIfNeeded(TMP_WS)
    expect(fs.existsSync(path.join(TMP_WS, '.plc-vis'))).toBe(true)
    expect(fs.existsSync(path.join(TMP_WS, '.sema', '.mcp.json'))).toBe(true)
    const mcp = JSON.parse(fs.readFileSync(path.join(TMP_WS, '.sema', '.mcp.json'), 'utf8'))
    expect(mcp.mcpServers['plc-tools'].env.PLC_STATE_FILE).toBe(`${TMP_WS}/.plc-vis/state.json`)
    expect(r.created.length).toBeGreaterThanOrEqual(2)  // at least .mcp.json + AGENTS.md
  })

  it('skips files that already exist (idempotent)', () => {
    setupWorkspaceIfNeeded(TMP_WS)
    const r2 = setupWorkspaceIfNeeded(TMP_WS)
    expect(r2.created).toEqual([])
    expect(r2.skipped.length).toBeGreaterThanOrEqual(2)
  })
})

describe('reconcileMcpModbusPort', () => {
  const mcpPath = path.join(TMP_WS, '.sema', '.mcp.json')
  const readEnv = () => JSON.parse(fs.readFileSync(mcpPath, 'utf8')).mcpServers['plc-tools'].env

  beforeEach(() => setupWorkspaceIfNeeded(TMP_WS))

  it('writes PLC_MODBUS_PORT into the plc-tools env when a port is given', () => {
    reconcileMcpModbusPort(TMP_WS, '502')
    expect(readEnv().PLC_MODBUS_PORT).toBe('502')
  })

  it('removes PLC_MODBUS_PORT when the port is unset (switch off)', () => {
    reconcileMcpModbusPort(TMP_WS, '502')
    reconcileMcpModbusPort(TMP_WS, undefined)
    expect('PLC_MODBUS_PORT' in readEnv()).toBe(false)
  })

  it('preserves the other env keys (does not clobber PLC_STATE_FILE)', () => {
    reconcileMcpModbusPort(TMP_WS, '5020')
    expect(readEnv().PLC_STATE_FILE).toBe(`${TMP_WS}/.plc-vis/state.json`)
  })

  it('is a no-op when there is no .mcp.json', () => {
    fs.rmSync(path.join(TMP_WS, '.sema'), { recursive: true, force: true })
    expect(() => reconcileMcpModbusPort(TMP_WS, '502')).not.toThrow()
  })

  it('setupWorkspaceIfNeeded applies PLC_MODBUS_PORT from the process env', () => {
    fs.rmSync(TMP_WS, { recursive: true, force: true })
    const prev = process.env.PLC_MODBUS_PORT
    process.env.PLC_MODBUS_PORT = '502'
    try {
      setupWorkspaceIfNeeded(TMP_WS)
      expect(readEnv().PLC_MODBUS_PORT).toBe('502')
    } finally {
      if (prev === undefined) delete process.env.PLC_MODBUS_PORT
      else process.env.PLC_MODBUS_PORT = prev
    }
  })
})

describe('scanStFiles', () => {
  it('returns empty array when workspace has no .st files', () => {
    fs.mkdirSync(TMP_WS, { recursive: true })
    expect(scanStFiles(TMP_WS)).toEqual([])
  })

  it('returns .st files sorted by mtime DESC', () => {
    fs.mkdirSync(TMP_WS, { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, 'old.st'), 'PROGRAM old END_PROGRAM')
    fs.utimesSync(path.join(TMP_WS, 'old.st'), 1, 1)  // ancient mtime
    fs.writeFileSync(path.join(TMP_WS, 'new.st'), 'PROGRAM new END_PROGRAM')

    const out = scanStFiles(TMP_WS)
    expect(out.length).toBe(2)
    expect(out[0].path.endsWith('new.st')).toBe(true)
    expect(out[1].path.endsWith('old.st')).toBe(true)
  })

  it('skips .sema, .plc-vis, node_modules, hidden dirs', () => {
    fs.mkdirSync(path.join(TMP_WS, '.sema'), { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, '.sema', 'ignored.st'), 'X')
    fs.mkdirSync(path.join(TMP_WS, 'samples'), { recursive: true })
    fs.writeFileSync(path.join(TMP_WS, 'samples', 'kept.st'), 'X')
    const out = scanStFiles(TMP_WS)
    expect(out.length).toBe(1)
    expect(out[0].path.endsWith('kept.st')).toBe(true)
  })
})

describe('readStFile / writeStFile', () => {
  it('round-trips content', () => {
    const f = path.join(TMP_WS, 'a', 'b.st')
    writeStFile(f, 'PROGRAM x END_PROGRAM')
    expect(readStFile(f)).toBe('PROGRAM x END_PROGRAM')
  })
})

// 切换工作区的唯一守卫。认领一个有内容的普通目录之后,setupWorkspaceIfNeeded 往里铺模板,
// 「重置」的 cleanWorkspace 把顶层全部 rm -rf —— 用户的仓库两次点击就没了。
describe('checkWorkspaceTarget', () => {
  const at = (name: string) => path.join(TMP_WS, name)

  it('放行:目录不存在(将新建)', () => {
    expect(checkWorkspaceTarget(at('brand-new'))).toBeNull()
  })

  it('放行:空目录', () => {
    fs.mkdirSync(at('empty'), { recursive: true })
    expect(checkWorkspaceTarget(at('empty'))).toBeNull()
  })

  it('放行:只有 .DS_Store 的目录仍算空(Finder 逛一圈就会生成)', () => {
    fs.mkdirSync(at('finder'), { recursive: true })
    fs.writeFileSync(path.join(at('finder'), '.DS_Store'), '')
    expect(checkWorkspaceTarget(at('finder'))).toBeNull()
  })

  it('放行:已是 PLC 工作区(有 .sema/.mcp.json),哪怕里面装满了生成物', () => {
    fs.mkdirSync(path.join(at('seeded'), '.sema'), { recursive: true })
    fs.writeFileSync(path.join(at('seeded'), '.sema', '.mcp.json'), '{}')
    fs.writeFileSync(path.join(at('seeded'), 'main.st'), 'PROGRAM x END_PROGRAM')
    expect(checkWorkspaceTarget(at('seeded'))).toBeNull()
  })

  it('拒绝:用户的代码仓库 —— 这是 rm -rf 删库那条路的入口', () => {
    fs.mkdirSync(path.join(at('my-app'), '.git'), { recursive: true })
    fs.writeFileSync(path.join(at('my-app'), 'package.json'), '{}')
    expect(checkWorkspaceTarget(at('my-app'))).toMatch(/既不是空目录/)
  })

  it('拒绝:顶层有 .st 但没建过工程的目录(.st 不是本产品独占的扩展名)', () => {
    fs.mkdirSync(at('smalltalk'), { recursive: true })
    fs.writeFileSync(path.join(at('smalltalk'), 'Foo.st'), '')
    expect(checkWorkspaceTarget(at('smalltalk'))).not.toBeNull()
  })

  it('拒绝:目标是文件而不是目录', () => {
    fs.mkdirSync(TMP_WS, { recursive: true })
    fs.writeFileSync(at('a-file'), 'x')
    expect(checkWorkspaceTarget(at('a-file'))).toMatch(/不是目录/)
  })
})

describe('plc-tools cli injection', () => {
  it('resolvePlcToolsCli 读模板 .mcp.json args[0](单一事实源),路径存在', () => {
    const cli = resolvePlcToolsCli()
    expect(cli).toMatch(/plc-tools\/dist\/cli\.js$/)
    expect(fs.existsSync(safePath(cli))).toBe(true)
  })
  it('substituteTokens 替换 __PLC_TOOLS_CLI__ 与 __WORKSPACE__,不残留占位符', () => {
    const out = substituteTokens('node __PLC_TOOLS_CLI__ verify plan.json; ws=__WORKSPACE__', '/ws')
    expect(out).toContain('/ws')
    expect(out).toContain(resolvePlcToolsCli())
    expect(out).not.toMatch(/__[A-Z_]+__/)
  })
})
