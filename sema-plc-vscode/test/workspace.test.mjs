// resolveWorkspace 的分支自检:node --test test/
// 核心回归防护 —— 默认绝不把用户打开的普通代码库当 PLC 工作区。
// server 启动就往工作区铺 AGENTS.md/.sema/config/,面板「重置」还会 rm -rf 整个工作区,
// 选错目录 = 删用户的仓库。
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

let workspaceEnv

const here = path.dirname(fileURLToPath(import.meta.url))
const extRoot = path.resolve(here, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-ws-'))

const GLOBAL_STORAGE = path.join(tmp, 'globalStorage')
const ctx = { globalStorageUri: { fsPath: GLOBAL_STORAGE } }

let resolveWorkspace, isPlcWorkspace, stateFileOf, stub
const realHome = process.env.HOME

/** 建一个目录并塞进给定的相对文件(内容无所谓,只看存在性)。 */
function makeDir(name, files = []) {
  const dir = path.join(tmp, name)
  for (const f of files) {
    const full = path.join(dir, f)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, '{}')
  }
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

before(async () => {
  const bundle = path.join(tmp, 'workspace.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'workspace.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  const req = createRequire(import.meta.url)
  ;({ resolveWorkspace, isPlcWorkspace, stateFileOf, workspaceEnv } = req(bundle))
  stub = req(path.join(here, 'stub-vscode.js'))

  // os.homedir() 在 POSIX 上读 $HOME —— 指到 tmp,legacy ~/plc-workspace 分支才可控,
  // 同时保证测试永远碰不到真实的 ~/plc-workspace。
  process.env.HOME = tmp
})

beforeEach(() => {
  stub.__state.config = {}
  stub.__state.folders = undefined
  fs.rmSync(path.join(tmp, 'plc-workspace'), { recursive: true, force: true })
})

after(() => {
  process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('普通代码库不会被当成工作区 —— 回落到扩展专属目录', () => {
  const repo = makeDir('my-app', ['package.json', 'src/index.ts', 'README.md'])
  stub.__state.folders = [{ uri: { fsPath: repo } }]

  const ws = resolveWorkspace(ctx)
  assert.equal(ws, path.join(GLOBAL_STORAGE, 'workspace'))
  assert.notEqual(ws, repo, '绝不能选中用户的代码库:面板「重置」会 rm -rf 它')
})

test('已初始化的工作区(.sema/.mcp.json)会被复用', () => {
  const seeded = makeDir('seeded', ['.sema/.mcp.json'])
  stub.__state.folders = [{ uri: { fsPath: seeded } }]
  assert.equal(resolveWorkspace(ctx), seeded)
})

test('顶层有 .st 也不算认领 —— .st 不是本产品独占的扩展名(Smalltalk / StringTemplate)', () => {
  const stDir = makeDir('st-proj', ['main.st', 'package.json'])
  stub.__state.folders = [{ uri: { fsPath: stDir } }]
  assert.equal(resolveWorkspace(ctx), path.join(GLOBAL_STORAGE, 'workspace'))
})

test('semaplc.workspace 覆盖一切', () => {
  const seeded = makeDir('seeded2', ['.sema/.mcp.json'])
  stub.__state.folders = [{ uri: { fsPath: seeded } }]
  stub.__state.config = { workspace: path.join(tmp, 'forced') }
  assert.equal(resolveWorkspace(ctx), path.join(tmp, 'forced'))
})

test('semaplc.workspace 填相对路径时按打开的文件夹解析,不按扩展宿主的 cwd', () => {
  const folder = makeDir('anchor', ['package.json'])
  stub.__state.folders = [{ uri: { fsPath: folder } }]
  stub.__state.config = { workspace: 'plc-ws' }
  assert.equal(resolveWorkspace(ctx), path.join(folder, 'plc-ws'))
  assert.notEqual(
    resolveWorkspace(ctx),
    path.resolve('plc-ws'),
    'cwd 在 macOS 上随 VSCode 启动方式漂移,不能拿它当基准',
  )
})

test('没打开文件夹时相对路径退回 HOME 为基准,不落到随机 cwd', () => {
  stub.__state.folders = undefined
  stub.__state.config = { workspace: 'plc-ws' }
  assert.equal(resolveWorkspace(ctx), path.join(tmp, 'plc-ws')) // HOME 已指到 tmp
})

test('已建过的 ~/plc-workspace(web 版默认)优先于专属目录', () => {
  makeDir('plc-workspace', ['.sema/.mcp.json']) // HOME 已指到 tmp
  const repo = makeDir('my-app2', ['package.json'])
  stub.__state.folders = [{ uri: { fsPath: repo } }]
  assert.equal(resolveWorkspace(ctx), path.join(tmp, 'plc-workspace'))
})

test('~/plc-workspace 不存在时不创建,直接用专属目录', () => {
  assert.equal(resolveWorkspace(ctx), path.join(GLOBAL_STORAGE, 'workspace'))
  assert.equal(fs.existsSync(path.join(tmp, 'plc-workspace')), false, '解析工作区不该有副作用')
})

test('没打开任何文件夹时也能解析', () => {
  stub.__state.folders = undefined
  assert.equal(resolveWorkspace(ctx), path.join(GLOBAL_STORAGE, 'workspace'))
})

test('isPlcWorkspace:目录不存在返回 false 而不是抛', () => {
  assert.equal(isPlcWorkspace(path.join(tmp, 'nope')), false)
})

test('stateFileOf 与 templates/.sema/.mcp.json 的 PLC_STATE_FILE 布局一致', () => {
  assert.equal(stateFileOf('/w'), path.join('/w', '.plc-vis', 'state.json'))
})

// 契约测试:模板是面板侧 agent 用的基准配置,MCP 侧漏掉其中任何一个工作区相关的 env,
// 就是一处静默降级(缺 PLC_SCENE_FILE 时 plc_buildSimulation 报成功却不落盘)。
// 以「值里含 __WORKSPACE__」为判据,模板加了新的工作区 env 这条会自动失败。
test('workspaceEnv 覆盖模板里全部工作区相关的 env,且路径一一对上', () => {
  const tpl = path.join(extRoot, '..', 'sema-plc-web', 'templates', '.sema', '.mcp.json')
  const env = JSON.parse(fs.readFileSync(tpl, 'utf8')).mcpServers['plc-tools'].env
  const expected = Object.fromEntries(
    Object.entries(env)
      .filter(([, v]) => v.includes('__WORKSPACE__'))
      .map(([k, v]) => [k, v.replaceAll('__WORKSPACE__', '/w')]),
  )
  assert.ok(Object.keys(expected).length >= 4, '模板应有至少 4 个工作区相关 env')
  assert.deepEqual(workspaceEnv('/w'), expected)
})
