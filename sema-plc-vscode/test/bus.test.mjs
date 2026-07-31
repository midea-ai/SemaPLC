// hub 的三条硬规矩:ready 之前不推、ready 之后重放 sticky、只重放 sticky 类型。
// 这三条错一条的表现都是「切回侧边栏一片空白」或「看到上一轮的陈旧状态」,
// 而它们在真实 VSCode 里都要靠人眼才发现 —— 所以在这里钉死。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { WebSocketServer } from 'ws'

const here = path.dirname(fileURLToPath(import.meta.url))
const extRoot = path.resolve(here, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-bus-'))

let Bus
let wss
let port
/** 服务端收到的 ClientMessage */
let received = []
/** 当前连上来的那条 socket(测试用它主动下推) */
let socket

const out = { appendLine: () => {} }

/**
 * 假 webview:记下扩展 postMessage 过来的每一条,并能反手模拟 webview 发消息。
 *
 * onDidReceiveMessage 必须是**多播**(每次注册都追加一个监听器,返回的 Disposable 摘掉
 * 自己)—— 真货就是这个语义。早先这里写成「后注册的覆盖前一个」,于是重复注册在测试里
 * 毫无症状,而在真实 VSCode 里表现为一条输入被发 N 次。fake 比真货宽容,等于没测。
 */
function fakeWebview() {
  const posted = []
  const handlers = new Set()
  return {
    posted,
    handlerCount: () => handlers.size,
    postMessage: (m) => {
      posted.push(m)
      return Promise.resolve(true)
    },
    onDidReceiveMessage: (h) => {
      handlers.add(h)
      return { dispose: () => handlers.delete(h) }
    },
    fromWebview: (m) => handlers.forEach((h) => h(m)),
  }
}

const waitFor = async (fn, label, ms = 3000) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`超时:${label}`)
}

before(async () => {
  const bundle = path.join(tmp, 'bus.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'bus.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'silent',
  })
  ;({ Bus } = createRequire(import.meta.url)(bundle))

  wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  wss.on('connection', (ws) => {
    socket = ws
    ws.on('message', (d) => received.push(JSON.parse(d.toString())))
  })
  await new Promise((r) => wss.once('listening', r))
  port = wss.address().port
})

after(() => {
  wss?.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('ready 之前不推任何东西,ready 之后重放 sticky', async (t) => {
  const bus = new Bus(out)
  t.after(() => bus.dispose())
  const wv = fakeWebview()
  bus.attach('chat', wv)
  socket = undefined // 上一个测试留下的连接还在 wss.clients 里,不清就会等到旧的
  bus.connect(port)
  await waitFor(() => socket, 'hub 连上来')

  // agent:state 是 sticky,agent:delta 不是
  socket.send(JSON.stringify({ type: 'agent:state', state: 'thinking' }))
  socket.send(JSON.stringify({ type: 'agent:delta', text: 'hi' }))
  await new Promise((r) => setTimeout(r, 100))

  assert.deepEqual(wv.posted, [], 'ready 之前一条都不该推 —— VSCode 不缓冲 postMessage,推了就是丢了')

  wv.fromWebview({ type: 'view:ready', view: 'chat' })
  await waitFor(() => wv.posted.length >= 2, '重放到达')

  const kinds = wv.posted.map((m) => (m.type === 'ws:message' ? m.payload.type : m.type))
  assert.ok(kinds.includes('ws:status'), '先告诉 webview 当前连接态')
  assert.ok(kinds.includes('agent:state'), 'sticky 类型必须重放')
  assert.ok(!kinds.includes('agent:delta'), '非 sticky 的增量不该重放 —— 重放它等于把半句话再说一遍')
})

test('ready 之后的消息直接转发;webview 的 ws:send 回灌到 server', async (t) => {
  const bus = new Bus(out)
  t.after(() => bus.dispose())
  const wv = fakeWebview()
  bus.attach('chat', wv)
  socket = undefined // 上一个测试留下的连接还在 wss.clients 里,不清就会等到旧的
  bus.connect(port)
  await waitFor(() => socket, 'hub 连上来')
  wv.fromWebview({ type: 'view:ready', view: 'chat' })
  await waitFor(() => wv.posted.some((m) => m.type === 'ws:status'), '握手完成')

  wv.posted.length = 0
  socket.send(JSON.stringify({ type: 'agent:delta', text: 'x' }))
  await waitFor(() => wv.posted.length > 0, '转发到达')
  assert.equal(wv.posted[0].payload.type, 'agent:delta')

  received = []
  wv.fromWebview({ type: 'ws:send', payload: { type: 'agent:prompt', text: 'hello' } })
  await waitFor(() => received.length > 0, 'server 收到回灌')
  assert.deepEqual(received[0], { type: 'agent:prompt', text: 'hello' })
})

test('重复 attach 同一个 view:只留最后一份订阅,一条输入就是一条', async (t) => {
  // 回归:resolveWebviewView 会被反复调用(用户每点一次 semaplc.open 就来一次),
  // 而每次 attach 都往同一个 webview 上挂一个 onDidReceiveMessage。旧的不摘掉,
  // 用户敲一句话就被转发 N 次 —— 界面上是同一句话连发好几条,agent 也真的跑了好几轮。
  const bus = new Bus(out)
  t.after(() => bus.dispose())
  const wv = fakeWebview()
  socket = undefined
  bus.connect(port)
  await waitFor(() => socket, 'hub 连上来')

  for (let i = 0; i < 5; i++) bus.attach('chat', wv)
  assert.equal(wv.handlerCount(), 1, 'attach 五次也只该留一个监听器')

  wv.fromWebview({ type: 'view:ready', view: 'chat' })
  await waitFor(() => wv.posted.some((m) => m.type === 'ws:status'), '握手完成')

  received = []
  wv.fromWebview({ type: 'ws:send', payload: { type: 'agent:prompt', text: 'hello' } })
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(received.length, 1, `一条输入只该到 server 一次,实际 ${received.length} 次`)
})

test('换端口时清掉 sticky —— 那是上一个 server 进程的状态', async (t) => {
  const bus = new Bus(out)
  t.after(() => bus.dispose())
  const wv = fakeWebview()
  bus.attach('chat', wv)
  socket = undefined // 上一个测试留下的连接还在 wss.clients 里,不清就会等到旧的
  bus.connect(port)
  await waitFor(() => socket, 'hub 连上来')
  socket.send(JSON.stringify({ type: 'workspace:ready', workspace: '/old' }))
  await new Promise((r) => setTimeout(r, 100))

  // 另起一个「新 server」,connect 到新端口
  const wss2 = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise((r) => wss2.once('listening', r))
  t.after(() => wss2.close())
  bus.connect(wss2.address().port)
  await waitFor(() => wss2.clients.size > 0, 'hub 改连新端口')

  wv.fromWebview({ type: 'view:ready', view: 'chat' })
  await waitFor(() => wv.posted.some((m) => m.type === 'ws:status'), '握手完成')
  const replayed = wv.posted.filter((m) => m.type === 'ws:message').map((m) => m.payload.type)
  assert.ok(!replayed.includes('workspace:ready'), '旧 server 的工作区状态不能带到新 server')
})
