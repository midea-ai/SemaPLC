// resolveWorkspaceFile 的边界自检:node --test test/
// 面板里点文件树会让扩展 openTextDocument,路径由 webview 报上来 —— 这是外部输入。
// 放行一条 ../ 就等于「网页能让 VSCode 打开磁盘上任意文件」,所以每条越界形态都要钉住。
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const here = path.dirname(fileURLToPath(import.meta.url))
const extRoot = path.resolve(here, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-panel-'))
const WS = path.join(tmp, 'ws')

let resolveWorkspaceFile

before(async () => {
  const bundle = path.join(tmp, 'panel.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'panel.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  ;({ resolveWorkspaceFile } = createRequire(import.meta.url)(bundle))
})

test('工作区内的相对路径 → 绝对路径', () => {
  assert.equal(resolveWorkspaceFile(WS, 'main.st'), path.join(WS, 'main.st'))
  assert.equal(resolveWorkspaceFile(WS, 'programs/a.st'), path.join(WS, 'programs', 'a.st'))
  // 内部有 .. 但没跑出去,合法
  assert.equal(resolveWorkspaceFile(WS, 'programs/../main.st'), path.join(WS, 'main.st'))
})

test('越界的一律 undefined', () => {
  assert.equal(resolveWorkspaceFile(WS, '../../etc/passwd'), undefined)
  assert.equal(resolveWorkspaceFile(WS, '/etc/passwd'), undefined)
  // 前缀相同但不是同一个目录:/…/ws-backup 不属于 /…/ws
  assert.equal(resolveWorkspaceFile(WS, path.join('..', 'ws-backup', 'x.st')), undefined)
  // 工作区自身是目录,不是能打开的文件
  assert.equal(resolveWorkspaceFile(WS, '.'), undefined)
})

test('非法输入的一律 undefined', () => {
  // NUL 截断:整条路径确实落在工作区内(越界的那些上面那组已经挡了),但 \0 之后的部分
  // 到了系统调用会被砍掉 —— 校验看到的和真正打开的不是同一个文件,这种路径一律不放行。
  assert.equal(resolveWorkspaceFile(WS, 'main.st\0.png'), undefined)
  assert.equal(resolveWorkspaceFile(WS, '\0'), undefined)
  assert.equal(resolveWorkspaceFile(WS, ''), undefined)
  assert.equal(resolveWorkspaceFile(WS, 42), undefined)
  assert.equal(resolveWorkspaceFile(WS, undefined), undefined)
  // server 没在跑时 currentWorkspace() 是 undefined —— 此时没有可信的基准,不能拿 cwd 顶
  assert.equal(resolveWorkspaceFile(undefined, 'main.st'), undefined)
})
