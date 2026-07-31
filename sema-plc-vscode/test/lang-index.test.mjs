// src/lang/index.ts 的接线自检 + package.json 贡献点的绊线:node --test test/
//
// 验的不是 provider 的逻辑(那三份测试各自管),而是「有没有被接上」:
// 少注册一个 provider、少一句 forgetSt、package.json 少一条 contributes,
// 代码全都照常编译、照常打包、真机上静默失效 —— 只有这里会红。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-lang-index-'))
const pkg = JSON.parse(fs.readFileSync(path.join(extRoot, 'package.json'), 'utf8'))

const SRC = 'PROGRAM main\nVAR x : BOOL; END_VAR\nx := TRUE;\nEND_PROGRAM\n'

let activateStLanguage, parseSt, vscode, ctx

/** 假 TextDocument:onDidClose 的监听器只用 uri。 */
const fakeDoc = (key) => ({ uri: { toString: () => key, fsPath: key } })

const callsOf = (kind) => vscode.__state.calls.filter((c) => c.kind === kind)

before(async () => {
  // index 与 ast 打进同一个 bundle:分开打会有两份 ast.ts 的模块级缓存,
  // 那样 forgetSt 的断言恒真(测的是另一份 Map),等于没测。
  const entry = path.join(tmp, 'entry.ts')
  fs.writeFileSync(
    entry,
    `export { activateStLanguage } from ${JSON.stringify(path.join(extRoot, 'src', 'lang', 'index'))}\n` +
      `export { parseSt } from ${JSON.stringify(path.join(extRoot, 'src', 'lang', 'ast'))}\n`,
  )
  const bundle = path.join(tmp, 'lang-index.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  const req = createRequire(import.meta.url)
  ;({ activateStLanguage, parseSt } = req(bundle))
  vscode = req('./stub-vscode.js')

  ctx = { subscriptions: [], extensionPath: extRoot }
  activateStLanguage(ctx, { appendLine() {}, show() {} })
})

test('五个 provider 全部注册,selector 都是 { language: "st" }', () => {
  for (const kind of ['documentSymbol', 'definition', 'documentHighlight', 'hover', 'completion']) {
    const calls = callsOf(kind)
    assert.equal(calls.length, 1, `${kind} 没注册(或注册了多次)`)
    assert.deepEqual(calls[0].sel, { language: 'st' })
    assert.ok(calls[0].provider, `${kind} 注册时没给 provider`)
  }
})

test('补全的 trigger 字符被展开成不定参,不是当数组传', () => {
  // registerCompletionItemProvider(sel, provider, ...triggers) —— 漏了展开符就是
  // triggers = [['.','(',':']],VSCode 侧一个触发字符都不生效,且不报错。
  assert.deepEqual(callsOf('completion')[0].triggers, ['.', '(', ':'])
})

test('诊断通道接上:semaplc.check 命令 + 保存监听', () => {
  assert.ok(
    callsOf('command').some((c) => c.id === 'semaplc.check'),
    'semaplc.check 未注册',
  )
  assert.equal(callsOf('onDidSave').length, 1, 'check-on-save 的监听没注册')
})

test('全部 disposable 都进了 ctx.subscriptions', () => {
  // 6 条注册(5 provider + onDidClose)+ diagnostics 自己的 4 条(collection、
  // onDidSave、onDidClose、command)。漏 push 的下场是 deactivate 后监听器还活着。
  assert.equal(ctx.subscriptions.length, 10)
})

test('关文档会清 AST 缓存(没有这句就是每开一个文件泄漏一棵 AST)', () => {
  const key = 'file:///leak.st'
  const first = parseSt(SRC, 1, key)
  assert.equal(parseSt(SRC, 1, key), first, '同 key+version 应该命中缓存')

  // index 的 forgetSt 与 diagnostics 的 collection.delete 都听 close,一起触发才是真实情形。
  for (const c of callsOf('onDidClose')) c.handler(fakeDoc(key))

  assert.notEqual(parseSt(SRC, 1, key), first, '关掉文档后缓存仍在 —— forgetSt 没接上')
})

// ── package.json 的贡献点:代码里注册了不等于用户能用到 ──────────────────────

test('contributes.snippets 指向真实存在的文件', () => {
  const entry = pkg.contributes.snippets?.find((s) => s.language === 'st')
  assert.ok(entry, 'snippets 没贡献 —— snippets/st.json 是死文件')
  assert.ok(fs.existsSync(path.join(extRoot, entry.path)), `snippets 路径不存在:${entry.path}`)
})

test('semaplc.check 在命令面板里搜得到', () => {
  // 运行时注册了但 contributes.commands 里没有 ⇒ Cmd+Shift+P 搜不到,等于没这个功能。
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'semaplc.check'))
})

test('check.onSave 默认关(多文件工程会满屏假错)', () => {
  const prop = pkg.contributes.configuration.properties['semaplc.check.onSave']
  assert.equal(prop.type, 'boolean')
  assert.equal(prop.default, false)
})

test('container.bin / container.name 是 machine scope', () => {
  // 保存即执行之后,这两条等于「可执行文件路径」。workspace 设置能覆盖的话,
  // 克隆一个自带 .vscode/settings.json 的仓库 + 打开 .st + Ctrl+S 就能跑任意二进制。
  for (const key of ['semaplc.container.bin', 'semaplc.container.name']) {
    assert.equal(pkg.contributes.configuration.properties[key].scope, 'machine', `${key} 缺 machine scope`)
  }
})
