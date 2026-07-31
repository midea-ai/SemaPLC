// src/lang/diagnostics.ts 的自检:node --test test/
// 被测的是 checkOutcome —— 决定「rusty 这次的输出该怎么落到 Problems 面板」的全部逻辑。
// 它不碰 vscode(vscode.Diagnostic 的构造留在 registerStDiagnostics 里),所以这里不需要造壳,
// 只是 diagnostics.ts 顶部 import 了 vscode,得让 esbuild 用已有的 stub 把它顶掉才打得动。
//
// 三条最贵的错误都在这里设了绊线:stdlib 的错冒充用户的错、1-based/0-based 差一、
// 以及基础设施故障被画成用户代码里的红波浪线。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-diag-'))

const STDLIB = '/opt/iec61131-stdlib'
let checkOutcome, checkTruncated, singleFlight, checkConfig
const state = createRequire(import.meta.url)('./stub-vscode.js').__state

/** 真容器里 `plc --check` 一次的形状:28 条 stdlib + 1 条用户代码(见方案 §2 P0-2)。 */
const REAL_SHAPE = {
  ok: false,
  raw: '',
  errorMessage: null,
  errors: [
    { code: 'E048', message: 'Could not resolve reference to BOOL_TO_BYTE', line: 12, col: 5, file: `${STDLIB}/bit_conversion.st` },
    { code: 'E048', message: 'Could not resolve reference to REAL_TO_INT', line: 340, col: 9, file: `${STDLIB}/numerical_functions.st` },
    { code: 'E037', message: "Invalid assignment: types BOOL and INT", line: 45, col: 1, file: '/tmp/plc-check-Ab3xQz.st' },
  ],
}

before(async () => {
  const bundle = path.join(tmp, 'diagnostics.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'lang', 'diagnostics.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  ;({ checkOutcome, checkTruncated, singleFlight, checkConfig } = createRequire(import.meta.url)(bundle))
})

test('stdlib 的错被滤掉,只剩用户代码那条', () => {
  const got = checkOutcome(REAL_SHAPE, STDLIB, 100)
  assert.equal(got.length, 1)
  assert.equal(got[0].code, 'E037')
})

test('行列 1-based → 0-based,两个都减一', () => {
  // rusty 报 45:1 ⇒ VSCode 的第 44 行第 0 列。少减一个就整体错行/错列。
  assert.deepEqual(checkOutcome(REAL_SHAPE, STDLIB, 100)[0], {
    line: 44,
    col: 0,
    code: 'E037',
    message: 'Invalid assignment: types BOOL and INT',
  })
})

test('stdlib 前缀按目录边界比,同前缀的兄弟目录不误杀', () => {
  const r = { ok: false, raw: '', errorMessage: null, errors: [
    { code: 'E001', message: 'x', line: 1, col: 1, file: `${STDLIB}-extra/mine.st` },
  ] }
  assert.equal(checkOutcome(r, STDLIB, 10).length, 1, '/opt/iec61131-stdlib-extra 不是 stdlib')
  assert.equal(checkOutcome(r, `${STDLIB}/`, 10).length, 1, 'stdlibDir 带不带尾斜杠结果一致')
})

test('line=null 的全局性错误留下并落到第 0 行', () => {
  // rusty 只在有 codespan 位置行时才给 file/line;无位置 = 归不到 stdlib 头上,丢掉用户就什么都看不到。
  const r = { ok: false, raw: '', errorMessage: null, errors: [
    { code: 'E072', message: 'no entry point found', line: null, col: null },
  ] }
  assert.deepEqual(checkOutcome(r, STDLIB, 10), [{ line: 0, col: 0, code: 'E072', message: 'no entry point found' }])
})

test('行号越界钳到最后一行(不能造出非法 Position)', () => {
  const r = { ok: false, raw: '', errorMessage: null, errors: [
    { code: 'E001', message: 'x', line: 9999, col: 3, file: '/tmp/mine.st' },
  ] }
  assert.equal(checkOutcome(r, STDLIB, 10)[0].line, 9, 'lineCount=10 ⇒ 合法行号上限是 9')
  // 空文档:lineCount 为 0 时不能算出 -1
  assert.equal(checkOutcome(r, STDLIB, 0)[0].line, 0)
})

test('errorMessage 非空 ⇒ 返回 null,collection 一个字都不许动', () => {
  // docker 没装 / 容器没起 / 容器里没有 plc 都走这条。既不能填(把环境问题画成代码错),
  // 也不能清空(把上一次真实的错误抹掉)。
  const r = { ok: false, raw: '', errorMessage: 'rusty check failed: spawn ENOENT', errors: [] }
  assert.equal(checkOutcome(r, STDLIB, 10), null)
})

test('ok=true ⇒ 空数组(清空 Problems),不是 null', () => {
  assert.deepEqual(checkOutcome({ ok: true, raw: '', errorMessage: null, errors: [] }, STDLIB, 10), [])
})

test('rusty 在 stdlib 上 panic ⇒ 这次检查是半截的,0 条错不许说「通过」', () => {
  // rusty v0.5.0 对 stdlib 必 panic(typesystem.rs:742,exit 101)。之前的链路是
  // 28 条错全被 stdlib 过滤 ⇒ 0 条 ⇒ 弹「检查通过,未发现问题」,而 panic 之后的阶段压根没跑。
  const raw = [
    "thread 'main' panicked at src/typesystem.rs:742:33:",
    'internal error: entered unreachable code',
    'note: run with `RUST_BACKTRACE=1` to display a backtrace',
  ].join('\n')
  assert.equal(checkTruncated(raw), true)
  assert.equal(checkTruncated('error[E037]: Invalid assignment: types BOOL and INT\n'), false)
  // 半截归半截,Problems 照填:panic 之前报出来的用户代码错是真的,
  // 返回 null 不动面板 = 每次都不动 = 把整个诊断功能关掉。
  assert.equal(checkOutcome({ ...REAL_SHAPE, raw }, STDLIB, 100).length, 1)
})

test('单飞:飞行途中来的第二次是排队补跑,不是丢掉', async () => {
  const key = 'file:///a.st'
  let finish
  let calls = 0
  const run = () => {
    calls++
    return new Promise((r) => {
      finish = r
    })
  }

  const first = singleFlight(key, run)
  assert.equal(calls, 1)
  // 丢掉的话 Problems 里留的是上一版内容算出的行号:用户改完保存,红波浪线还指着旧位置。
  assert.equal(await singleFlight(key, run), null, '飞行途中不该重入')
  assert.equal(calls, 1)

  finish('done')
  assert.equal(await first, 'done')
  assert.equal(calls, 2, '排队的那次被丢了')

  finish('trailing')
  await new Promise((r) => setImmediate(r))
  assert.equal(await singleFlight(key, async () => 'again'), 'again', '补跑结束后 key 没清掉')
})

test('容器名过白名单:非法名不进 docker 的 argv', () => {
  // 这个值会原样进 execFile 的参数表。runtime-guide 里已有 CONTAINER_RE,诊断通道必须复用它 ——
  // 自己 `cfg.get(...) || 默认值` 的话,非法名只是静默失败,是最难查的一种。
  state.config['container.name'] = 'plc; rm -rf /'
  assert.throws(() => checkConfig('docker'), /非法/)

  state.config['container.name'] = 'openplc-plc-dev'
  assert.equal(checkConfig('docker').container, 'openplc-plc-dev')

  delete state.config['container.name']
  assert.equal(checkConfig('docker').container, 'openplc-plc-dev', '留空该回落到默认容器名')
})
