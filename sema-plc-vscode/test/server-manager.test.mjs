// ServerManager 的进程生命周期自检:node --test test/
// 用 esbuild 把 server-manager.ts 打成 CJS 并把 'vscode' alias 成 stub,不需要跑扩展宿主。
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const here = path.dirname(fileURLToPath(import.meta.url))
const extRoot = path.resolve(here, '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-sm-'))
const WORKSPACE = path.join(tmp, 'ws')

let ServerManager

before(async () => {
  const bundle = path.join(tmp, 'server-manager.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'server-manager.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  ;({ ServerManager } = createRequire(import.meta.url)(bundle))

  // ServerManager 找的第一个入口候选就是 <extensionPath>/vendor/server/server.bundle.mjs
  const vendorServer = path.join(tmp, 'ext', 'vendor', 'server')
  fs.mkdirSync(vendorServer, { recursive: true })
  fs.mkdirSync(WORKSPACE, { recursive: true })
  fs.copyFileSync(path.join(here, 'fake-server.mjs'), path.join(vendorServer, 'server.bundle.mjs'))
})

// 兜底:产品代码若漏杀,detached 子进程会吊着 stdout 管道让测试进程永不退出 —— 那样就成了挂起
// 而不是一条能看懂的失败。这里强杀所有起过的 pid,保证断言失败能正常报出来。
const spawnedPids = []
after(() => {
  for (const pid of spawnedPids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* 已退出 */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** 攒下 server 的 stdout,用来抠出假 server 打印的 pid。 */
function makeManager(t) {
  const log = []
  const record = (s) => {
    log.push(String(s))
    const m = /pid=(\d+)/.exec(String(s))
    if (m) spawnedPids.push(Number(m[1]))
  }
  const out = { appendLine: record, append: record, show: () => {} }
  const status = { text: '', tooltip: '', backgroundColor: undefined, show: () => {}, dispose: () => {} }
  const ctx = {
    extensionPath: path.join(tmp, 'ext'),
    globalStorageUri: { fsPath: path.join(tmp, 'globalStorage') },
    secrets: { get: async () => undefined },
    subscriptions: [],
  }
  const manager = new ServerManager(ctx, out, status)
  // 断言失败也必须收干净:detached 子进程吊着 stdout 管道,漏一个测试进程就永远退不出。
  t.after(() => manager.stop())
  return { manager, log }
}

const healthy = (port) =>
  fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
    .then((r) => r.ok)
    .catch(() => false)

async function waitFor(fn, label, ms = 20_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`等待超时:${label}`)
}

const pidsFrom = (log) => [...log.join('\n').matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('启动成功后 health 可达,stop 后子进程被回收', async (t) => {
  const { manager, log } = makeManager(t)
  const ports = await manager.start(WORKSPACE)
  assert.ok(ports.httpPort > 0 && ports.wsPort > 0)
  assert.notEqual(ports.httpPort, ports.wsPort, 'http/ws 端口不能撞在一起')
  assert.equal(await healthy(ports.httpPort), true)

  const [pid] = pidsFrom(log)
  await manager.stop()
  await waitFor(async () => !alive(pid), 'stop 后进程退出')
})

test('异常退出后自动重启,且沿用原端口(bus 靠重连接回去,不重建 webview)', async (t) => {
  const { manager, log } = makeManager(t)
  // 不再有 acquire/release:整合面板下线后 server 的生死不挂引用计数了,
  // 自动重启的唯一条件是「这一轮还没重启过」。
  const first = await manager.start(WORKSPACE)
  const [pid] = pidsFrom(log)

  process.kill(pid, 'SIGKILL') // 非 0 退出 ⇒ 触发自动重启
  await waitFor(() => healthy(first.httpPort), '自动重启后 health 恢复')

  const second = await manager.start(WORKSPACE)
  assert.deepEqual(second, first, '重启必须复用原端口,否则 bus 重连会连到没人监听的端口')

  const pids = pidsFrom(log)
  assert.equal(pids.length, 2, '应当只重启了一次')
  assert.equal(alive(pids[0]), false, '被杀的旧进程不该还在')

  await manager.stop()
  await waitFor(async () => !alive(pids[1]), 'stop 后进程退出')
})

test('启动超时:进程必须被收掉,不留 detached 孤儿', { timeout: 40_000 }, async (t) => {
  process.env.FAKE_MODE = 'sick' // listen 但 health 永远 500 ⇒ waitHealthy 15s 超时
  try {
    const { manager, log } = makeManager(t)
    await assert.rejects(() => manager.start(WORKSPACE), /未就绪/)

    const [pid] = pidsFrom(log)
    assert.ok(pid, '假 server 应该已经起来并打印过 pid')
    await waitFor(async () => !alive(pid), '超时的 server 进程被 kill', 5000)
  } finally {
    delete process.env.FAKE_MODE
  }
})

// ── semaplc.envFile ────────────────────────────────────────────────────────────
// 直接调 buildEnv:起真进程只能验证"活着",验证不了注入了什么。private 只是 TS 层面的。
const stub = createRequire(import.meta.url)('./stub-vscode.js')

function envOf(t, { config = {}, secrets = {} } = {}) {
  const saved = { ...stub.__state.config }
  Object.assign(stub.__state.config, config)
  t.after(() => { stub.__state.config = saved })
  const ctx = {
    extensionPath: path.join(tmp, 'ext'),
    globalStorageUri: { fsPath: path.join(tmp, 'globalStorage') },
    secrets: { get: async (k) => secrets[k] },
    subscriptions: [],
  }
  const out = { appendLine: () => {}, append: () => {}, show: () => {} }
  const status = { text: '', tooltip: '', backgroundColor: undefined, show: () => {}, dispose: () => {} }
  return new ServerManager(ctx, out, status).buildEnv(41111, 41112)
}

test('envFile:key 注入,扩展自控的端口不被 .env 顶掉', async (t) => {
  const f = path.join(tmp, 'inject.env')
  fs.writeFileSync(f, 'BIGMODEL_API_KEY=bm-1\nPORT=3001\nWS_PORT=3002\n')
  const env = await envOf(t, { config: { envFile: f } })
  assert.equal(env.BIGMODEL_API_KEY, 'bm-1')
  assert.equal(env.PORT, '41111', 'PORT 必须是 freePorts 挑的那个')
  assert.equal(env.WS_PORT, '41112')
})

test('envFile 的 PLC_MODEL 在用户没显式设 semaplc.model 时生效', async (t) => {
  const f = path.join(tmp, 'model.env')
  fs.writeFileSync(f, 'PLC_MODEL=bigmodel\n')
  const env = await envOf(t, { config: { envFile: f } })
  // 回归:semaplc.model 默认值 'deepseek' 曾无条件覆盖这里 —— 用户配好 .env 却发现
  // 跑的还是那个没配 key 的 deepseek。
  assert.equal(env.PLC_MODEL, 'bigmodel')
})

test('显式设过 semaplc.model 时,它压过 .env', async (t) => {
  const f = path.join(tmp, 'model2.env')
  fs.writeFileSync(f, 'PLC_MODEL=bigmodel\n')
  const env = await envOf(t, { config: { envFile: f, model: 'qwen' } })
  assert.equal(env.PLC_MODEL, 'qwen')
})

test('两边都配时 SecretStorage 压过 .env', async (t) => {
  const f = path.join(tmp, 'both.env')
  fs.writeFileSync(f, 'DEEPSEEK_API_KEY=from-file\n')
  const env = await envOf(t, { config: { envFile: f }, secrets: { DEEPSEEK_API_KEY: 'from-secrets' } })
  assert.equal(env.DEEPSEEK_API_KEY, 'from-secrets')
})

test('没配 envFile 时不读任何文件,PLC_MODEL 回落到默认', async (t) => {
  const env = await envOf(t)
  assert.equal(env.PLC_MODEL, 'deepseek')
})
