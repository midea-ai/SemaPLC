// semaplc.envFile 的解析。这条路把一个用户指定的文件内容灌进 server 进程的环境变量,
// 解析错的代价从「少几个模型」到「端口被顶掉、server 起不来」都有,所以逐条钉住。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-env-'))

let parseEnvFile, resolveEnvPath, loadEnvFile

before(async () => {
  const bundle = path.join(tmp, 'env-file.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'env-file.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
  })
  ;({ parseEnvFile, resolveEnvPath, loadEnvFile } = createRequire(import.meta.url)(bundle))
})

test('KEY=VALUE / export / 注释 / 空行', () => {
  const got = parseEnvFile(
    ['# 注释', '', 'DEEPSEEK_API_KEY=sk-abc', 'export QWEN_API_KEY=qw-1', '  PLC_MODEL=bigmodel  ', '不是键值对'].join('\n'),
  )
  assert.deepEqual(got, { DEEPSEEK_API_KEY: 'sk-abc', QWEN_API_KEY: 'qw-1', PLC_MODEL: 'bigmodel' })
})

test('成对引号脱掉,值里的 = 和 # 保留', () => {
  const got = parseEnvFile(['A="sk-with=equals"', "B='single'", 'C=raw#notacomment', 'D="未闭合'].join('\n'))
  assert.equal(got.A, 'sk-with=equals')
  assert.equal(got.B, 'single')
  // 裸值里的 # 不当注释:API key 里出现 # 完全合法,截断会得到一个悄悄失效的 key。
  assert.equal(got.C, 'raw#notacomment')
  assert.equal(got.D, '"未闭合')
})

test('扩展自控的键一律忽略 —— 端口被顶掉就是 server 起不来', () => {
  const got = parseEnvFile(
    ['PORT=3001', 'WS_PORT=3002', 'SEMAPLC_DATA_DIR=/tmp/x', 'PLC_WORKSPACE=/tmp/y', 'PLC_ENGINE=none', 'PLC_TOOLS_DIST=/tmp/z', 'KEEP_ME=1'].join('\n'),
  )
  assert.deepEqual(got, { KEEP_ME: '1' })
})

test('非法键名跳过(注入形状的行不会变成变量)', () => {
  const got = parseEnvFile(['1BAD=x', 'has space=y', 'has-dash=z', 'OK_1=v', '=novalue'].join('\n'))
  assert.deepEqual(got, { OK_1: 'v' })
})

test('CRLF 文件不会把 \\r 带进值里', () => {
  assert.equal(parseEnvFile('A=1\r\nB=2\r\n').A, '1')
  assert.equal(parseEnvFile('A=1\r\nB=2\r\n').B, '2')
})

test('resolveEnvPath:~ 展开 / 绝对路径原样 / 相对按 base', () => {
  assert.equal(resolveEnvPath('~/a/.env'), path.join(os.homedir(), 'a/.env'))
  assert.equal(resolveEnvPath('/abs/.env', '/base'), '/abs/.env')
  assert.equal(resolveEnvPath('sub/.env', '/base'), path.resolve('/base', 'sub/.env'))
})

test('loadEnvFile:读不到只记日志,返回空对象(不能让 server 起不来)', () => {
  const logs = []
  const got = loadEnvFile(path.join(tmp, 'nope.env'), (m) => logs.push(m))
  assert.deepEqual(got, {})
  assert.equal(logs.length, 1)
  assert.match(logs[0], /读不到/)
})

test('loadEnvFile:日志只出现键名,绝不出现值(用户会截图发出来)', () => {
  const file = path.join(tmp, 'real.env')
  fs.writeFileSync(file, 'DEEPSEEK_API_KEY=sk-super-secret-value\n')
  const logs = []
  const got = loadEnvFile(file, (m) => logs.push(m))
  assert.equal(got.DEEPSEEK_API_KEY, 'sk-super-secret-value')
  assert.match(logs[0], /DEEPSEEK_API_KEY/)
  assert.doesNotMatch(logs[0], /sk-super-secret-value/)
})
