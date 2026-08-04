// buildWebviewHtml 写错的代价是「侧边栏一片空白且不报任何错」—— CSP 拦下的脚本
// 只在 webview 的开发者工具里留一行,扩展这侧毫无感知。所以这里逐条钉住产出的 HTML。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-host-'))
const WEB_ROOT = path.join(tmp, 'web')

let buildWebviewHtml, resolveWebRoot

// vite 真实产物的形状:module script + 两个 stylesheet,路径都是 ./assets/… 相对路径。
const CHAT_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>SemaPLC Chat</title>
    <script type="module" crossorigin src="./assets/chat-abc.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-def.css">
  </head>
  <body><div id="root"></div></body>
</html>`

/** 假 webview:asWebviewUri 按 VSCode 真实行为换成 vscode-webview 协议的 URI。 */
const webview = {
  cspSource: 'vscode-webview://fake',
  asWebviewUri: (uri) => ({ toString: () => `vscode-webview://fake${uri.fsPath}` }),
}

before(async () => {
  fs.mkdirSync(path.join(WEB_ROOT, 'assets'), { recursive: true })
  fs.writeFileSync(path.join(WEB_ROOT, 'chat.html'), CHAT_HTML)
  fs.writeFileSync(path.join(WEB_ROOT, 'index.html'), '<html><head></head></html>')

  const bundle = path.join(tmp, 'host.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'webview-host.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  ;({ buildWebviewHtml, resolveWebRoot } = createRequire(import.meta.url)(bundle))
})

test('相对资源路径全部重写成 webview URI —— 不重写就是 404 白板', () => {
  const html = buildWebviewHtml(webview, WEB_ROOT, 'chat.html')
  assert.ok(!/src="\.\//.test(html), `还有没重写的 src:${html}`)
  assert.ok(!/href="\.\//.test(html), `还有没重写的 href:${html}`)
  assert.ok(html.includes(`vscode-webview://fake${path.join(WEB_ROOT, 'assets', 'chat-abc.js')}`))
  assert.ok(html.includes(`vscode-webview://fake${path.join(WEB_ROOT, 'assets', 'index-def.css')}`))
})

test('CSP 放行 cspSource 下的脚本与样式', () => {
  const html = buildWebviewHtml(webview, WEB_ROOT, 'chat.html')
  const csp = /content="([^"]+)"/.exec(html)?.[1] ?? ''
  assert.match(csp, /script-src [^;]*vscode-webview:\/\/fake/, '脚本源没放行 ⇒ 侧边栏白板')
  assert.match(csp, /style-src [^;]*vscode-webview:\/\/fake/)
  assert.match(csp, /default-src 'none'/, '默认应当是零出口')
})

test("CSP 里不留 nonce —— 留了但 vite 的 script 不带 nonce,反而是自己给自己下绊", () => {
  // 规范上 nonce 与 host-source 对外部脚本是并列放行的,不冲突;但既然已经没有 inline
  // 脚本要保护,留一个每次都变的 nonce 只会让人以为它在起作用。
  const html = buildWebviewHtml(webview, WEB_ROOT, 'chat.html')
  assert.ok(!html.includes('nonce'), 'CSP 或标签里不该再出现 nonce')
})

test('webview 零网络出口:不留 connect-src', () => {
  const html = buildWebviewHtml(webview, WEB_ROOT, 'chat.html')
  const csp = /content="([^"]+)"/.exec(html)?.[1] ?? ''
  // hub 模式下收发全走 postMessage。哪天梯形图预览要直连 /api,应当按入口单独放开,
  // 而不是在这里对所有 webview 统一开口。
  assert.ok(!csp.includes('connect-src'), 'connect-src 不该再出现 —— 默认 none 已经够了')
})

test('CSP meta 插在 head 里,且在资源标签之前', () => {
  const html = buildWebviewHtml(webview, WEB_ROOT, 'chat.html')
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP 必须先于脚本出现')
  assert.ok(html.includes('<head><meta http-equiv="Content-Security-Policy"'))
})

test('版本走 meta 注入,不传就不注入;引号被转义', () => {
  // 空态那行 `sema-plc v0.1.0` 读的就是这个 meta;注入成 inline script 会连 nonce 一起
  // 要回来,而 CSP 里刚把 nonce 拿掉。
  assert.ok(!buildWebviewHtml(webview, WEB_ROOT, 'chat.html').includes('semaplc-version'))
  const html = buildWebviewHtml(webview, WEB_ROOT, 'chat.html', '0.1.0')
  assert.ok(html.includes('<meta name="semaplc-version" content="0.1.0">'))
  const evil = buildWebviewHtml(webview, WEB_ROOT, 'chat.html', '1.0" onload="x')
  assert.ok(!/content="1\.0" onload=/.test(evil), '引号必须转义,否则 meta 标签被撑开')
})

test('resolveWebRoot 认 media/web,认不出就返回 undefined', () => {
  const ext = path.join(tmp, 'ext')
  fs.mkdirSync(path.join(ext, 'media', 'web'), { recursive: true })
  assert.equal(resolveWebRoot(ext), undefined, '没有 index.html 不算产物目录')
  fs.writeFileSync(path.join(ext, 'media', 'web', 'index.html'), '<html></html>')
  assert.equal(resolveWebRoot(ext), path.join(ext, 'media', 'web'))
})
