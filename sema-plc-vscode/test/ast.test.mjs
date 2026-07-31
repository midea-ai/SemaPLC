// src/lang/ast.ts 的自检:node --test test/
// 这层是 symbols / definition / hover / completion / diagnostics 五个 provider 的共同地基,
// 它给出的 loc 一旦错位,Problems 面板和 F12 会集体指错行 —— 比没有更糟。
// ast.ts 不 import vscode,这里只需要 esbuild 把跨包 import 打平(tsc 之外的第二道验证:
// 真打得动才说明 moduleResolution 那套配置在 esbuild 侧也成立)。
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-ast-'))

let parseSt, forgetSt, programAt, declarationsAt, findDeclaration, locateName, eqName, stripConfigurationBlock

// 文件级 VAR_GLOBAL + 双 POU + CONFIGURATION:真实工程的形状(OpenPLC 硬要求结尾那段)。
const SRC = `VAR_GLOBAL
    shared : BOOL;
END_VAR

PROGRAM main
VAR
    start AT %IX0.0 : BOOL := FALSE;
    count : INT := 0;
END_VAR
count := count + 1;
END_PROGRAM

FUNCTION_BLOCK Debounce
VAR_INPUT
    raw : BOOL;
END_VAR
VAR_OUTPUT
    clean : BOOL;
END_VAR
clean := raw;
END_FUNCTION_BLOCK

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : main;
END_RESOURCE
END_CONFIGURATION
`

before(async () => {
  const bundle = path.join(tmp, 'ast.cjs')
  await esbuild.build({
    entryPoints: [path.join(extRoot, 'src', 'lang', 'ast.ts')],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: path.join(here, 'stub-vscode.js') },
    logLevel: 'silent',
  })
  const req = createRequire(import.meta.url)
  ;({ parseSt, forgetSt, programAt, declarationsAt, findDeclaration, locateName, eqName, stripConfigurationBlock } =
    req(bundle))
})

test('剥掉 CONFIGURATION 后两个 POU 都在,且无假错', () => {
  const ast = parseSt(SRC, 1, 'a.st')
  assert.deepEqual(
    ast.programs.map((p) => p.name),
    ['main', 'Debounce'],
  )
  assert.deepEqual(ast.errors, [])
})

test('loc 是原文档偏移,不需要 sourcemap', () => {
  const ast = parseSt(SRC, 1, 'loc.st')
  const fb = ast.programs[1]
  assert.ok(SRC.slice(fb.loc.start, fb.loc.end).startsWith('FUNCTION_BLOCK Debounce'))
  // 行号也对齐:FB 在原文第 13 行(1-based)
  assert.equal(SRC.slice(0, fb.loc.start).split('\n').length, 13)
})

test('同 version 命中缓存,version 变了重解析', () => {
  const a = parseSt(SRC, 3, 'cache.st')
  assert.equal(parseSt(SRC, 3, 'cache.st'), a, '同 version 应返回同一个对象')
  assert.notEqual(parseSt(SRC, 4, 'cache.st'), a, 'version 变了必须重解析')
  // key 隔离:另一个文档不该拿到上一个的 AST
  assert.notEqual(parseSt('PROGRAM other\nEND_PROGRAM\n', 3, 'other.st'), a)
})

test('forgetSt 之后同 version 也会重解析(关文档不留 AST)', () => {
  const a = parseSt(SRC, 7, 'drop.st')
  forgetSt('drop.st')
  assert.notEqual(parseSt(SRC, 7, 'drop.st'), a)
})

test('programAt 按偏移定位 POU', () => {
  const ast = parseSt(SRC, 1, 'at.st')
  assert.equal(programAt(ast, SRC.indexOf('count := count'))?.name, 'main')
  assert.equal(programAt(ast, SRC.indexOf('clean := raw'))?.name, 'Debounce')
  // CONFIGURATION 段已被抹平,落在那里不属于任何 POU
  assert.equal(programAt(ast, SRC.indexOf('RESOURCE')), undefined)
})

test('declarationsAt 给出局部 + 全局,局部在前', () => {
  const ast = parseSt(SRC, 1, 'scope.st')
  const inMain = declarationsAt(ast, SRC.indexOf('count := count')).map((s) => s.decl.names[0])
  assert.deepEqual(inMain, ['start', 'count', 'shared'])
  const inFb = declarationsAt(ast, SRC.indexOf('clean := raw')).map((s) => s.decl.names[0])
  assert.deepEqual(inFb, ['raw', 'clean', 'shared'])
  // 文件级 VAR_GLOBAL 没有宿主 POU
  assert.equal(declarationsAt(ast, 0).find((s) => s.decl.names[0] === 'shared')?.program, undefined)
})

test('findDeclaration 大小写不敏感,且带回作用域种类', () => {
  const ast = parseSt(SRC, 1, 'find.st')
  const off = SRC.indexOf('count := count')
  assert.equal(findDeclaration(ast, 'COUNT', off)?.block.scope, 'VAR')
  assert.equal(findDeclaration(ast, 'Start', off)?.decl.atAddress, '%IX0.0')
  // 别的 POU 的局部变量不该被看见
  assert.equal(findDeclaration(ast, 'raw', off), undefined)
  assert.equal(eqName('Motor_1', 'MOTOR_1'), true)
})

test('locateName 落在名字本身而不是整块', () => {
  const ast = parseSt(SRC, 1, 'name.st')
  const fb = ast.programs[1]
  const loc = locateName(SRC, fb.loc, fb.name)
  assert.equal(SRC.slice(loc.start, loc.end), 'Debounce')
  const decl = ast.programs[0].varBlocks[0].declarations[1]
  const dloc = locateName(SRC, decl.loc, decl.names[0])
  assert.equal(SRC.slice(dloc.start, dloc.end), 'count')
})

test('stripConfigurationBlock 原样透出,诊断通道直接用', () => {
  const out = stripConfigurationBlock(SRC)
  assert.equal(out.length, SRC.length)
  assert.equal(out.slice(SRC.indexOf('CONFIGURATION')).trim(), '')
})
