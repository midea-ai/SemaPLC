// src/lang/symbols.ts + src/lang/definition.ts 的自检:node --test test/
//
// 只测纯层(outlineOf / wordAt / definitionOf / highlightsOf)。provider 那几行是
// `new vscode.DocumentSymbol(...)` 的直译,要测它就得伪造一份 TextDocument,
// 而伪造出来的 positionAt / 取词只能验证伪造品本身。vscode 在这里被 esbuild 换成空壳,
// 纯层根本不碰它 —— 换不掉才说明分层破了。
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
const samples = path.resolve(extRoot, '..', 'sema-plc-tools', 'runtime', 'samples')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-symbols-'))

let outlineOf, wordAt, definitionOf, highlightsOf, parseSt

// 三种 POU + VAR CONSTANT + ARRAY + AT 地址 + 注释里的同名词 + FB 实例调用。
// 仓库里的真实样本全是单 PROGRAM,覆盖不到这些形状,所以另起一份。
const SRC = `FUNCTION Add : INT
VAR_INPUT
    a, b : INT;
END_VAR
VAR CONSTANT
    bias : INT := 1;
END_VAR
Add := a + b + bias;
END_FUNCTION

FUNCTION_BLOCK Debounce
VAR_INPUT
    raw : BOOL;
END_VAR
VAR
    buf : ARRAY[1..8] OF BOOL;
    Motor AT %QX0.0 : BOOL;
END_VAR
(* raw 在注释里,不该被高亮 *)
motor := raw;
MOTOR := FALSE;
END_FUNCTION_BLOCK

PROGRAM main
VAR
    d : Debounce;
END_VAR
d(raw := TRUE);
END_PROGRAM
`

/** 大纲节点的先序展开,断言里按名字挑就行。 */
function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n)
    flatten(n.children, out)
  }
  return out
}

const readSample = (name) => fs.readFileSync(path.join(samples, name), 'utf8')

function outlineOfSample(name) {
  const text = readSample(name)
  return { text, tree: outlineOf(text, parseSt(text, 1, name)) }
}

before(async () => {
  // symbols 与 definition 打进同一个 bundle:definition 引 symbols 的 rangeOf,
  // 分两个 bundle 会各持一份 ast.ts 的缓存,测出来的就不是产品里跑的那份了。
  const entry = path.join(tmp, 'entry.ts')
  const langDir = path.join(extRoot, 'src', 'lang')
  fs.writeFileSync(
    entry,
    `export * from ${JSON.stringify(path.join(langDir, 'symbols'))}\n` +
      `export * from ${JSON.stringify(path.join(langDir, 'definition'))}\n` +
      `export { parseSt } from ${JSON.stringify(path.join(langDir, 'ast'))}\n`,
  )
  const bundle = path.join(tmp, 'lang.cjs')
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
  ;({ outlineOf, wordAt, definitionOf, highlightsOf, parseSt } = req(bundle))
})

test('真实样本:POU → VAR 块 → 变量三层', () => {
  const { tree } = outlineOfSample('traffic_light.st')
  assert.deepEqual(
    tree.map((n) => [n.name, n.kind]),
    [['traffic_light', 'Module']],
  )
  assert.deepEqual(
    tree[0].children.map((n) => [n.name, n.kind]),
    [['VAR', 'Namespace']],
  )
  const vars = tree[0].children[0].children
  assert.equal(vars.length, 15)
  const byName = (n) => vars.find((v) => v.name === n)
  // AT 地址的是 IO 点位 ⇒ Field 图标,一眼从内部变量里挑出来
  assert.equal(byName('emergency_button').kind, 'Field')
  assert.equal(byName('emergency_button').detail, 'BOOL AT %IX0.0')
  assert.equal(byName('state').kind, 'Variable')
  assert.equal(byName('state').detail, 'INT')
})

test('真实样本:%QW 输出也是 Field,detail 带地址', () => {
  const { tree } = outlineOfSample('simple_counter.st')
  const vars = tree[0].children[0].children
  assert.equal(vars.find((v) => v.name === 'counter_value').kind, 'Field')
  assert.equal(vars.find((v) => v.name === 'counter_value').detail, 'INT AT %QW0')
  assert.equal(vars.find((v) => v.name === 'counter').kind, 'Variable')
})

test('多 POU 文件出多个顶层符号(P0-3 之前只会出第一个)', () => {
  const tree = outlineOf(SRC, parseSt(SRC, 1, 'multi.st'))
  assert.deepEqual(
    tree.map((n) => [n.name, n.kind, n.detail]),
    [
      ['Add', 'Function', 'INT'], // FUNCTION 的返回类型进 detail
      ['Debounce', 'Class', ''],
      ['main', 'Module', ''],
    ],
  )
  // 限定符进显示名
  assert.deepEqual(
    tree[0].children.map((n) => n.name),
    ['VAR_INPUT', 'VAR CONSTANT'],
  )
  // 一行两个名字 ⇒ 两个符号
  assert.deepEqual(
    tree[0].children[0].children.map((v) => v.name),
    ['a', 'b'],
  )
  // 数组维度直接切原文,不重拼
  const fbVars = tree[1].children.find((b) => b.name === 'VAR').children
  assert.equal(fbVars.find((v) => v.name === 'buf').detail, 'ARRAY[1..8] OF BOOL')
})

test('selection 落在名字本身,且被 range 包住(VSCode 的硬要求)', () => {
  const cases = [{ text: SRC, tree: outlineOf(SRC, parseSt(SRC, 1, 'sel.st')) }, outlineOfSample('traffic_light.st')]
  for (const { text, tree } of cases) {
    for (const n of flatten(tree)) {
      const shown = text.slice(n.selection.start, n.selection.end)
      assert.ok(shown.length > 0, `${n.name} 的 selection 空了`)
      // `VAR CONSTANT` 的显示名比源码里那个关键字长,其余都应精确相等
      assert.ok(n.name.startsWith(shown), `${n.name} 的 selection 指向 ${shown}`)
      assert.ok(n.range.start <= n.selection.start && n.selection.end <= n.range.end, `${n.name} 的 selection 越界`)
      for (const c of n.children) {
        assert.ok(n.range.start <= c.range.start && c.range.end <= n.range.end, `${c.name} 超出父范围`)
      }
    }
  }
})

test('wordAt 词中词尾都取到,落在符号上取不到', () => {
  const at = SRC.indexOf('bias : INT')
  assert.equal(wordAt(SRC, at + 2)?.name, 'bias')
  assert.equal(wordAt(SRC, at + 4)?.name, 'bias', '光标停在词尾也该算命中')
  assert.equal(wordAt(SRC, SRC.indexOf(' := 1') + 1), undefined)
})

test('definitionOf:引用跳到声明,大小写不敏感', () => {
  const ast = parseSt(SRC, 1, 'def.st')
  // 引用写的是 motor,声明是 Motor —— 落点必须是声明那一处
  const loc = definitionOf(ast, SRC, SRC.indexOf('motor := raw'))
  assert.equal(SRC.slice(loc.start, loc.end), 'Motor')
  assert.equal(SRC.slice(loc.start - 4, loc.start), '    ', '应落在声明行的名字上')
})

test('definitionOf:变量找不到时退回同名 POU;跨 POU 的局部变量不可见', () => {
  const ast = parseSt(SRC, 1, 'pou.st')
  const loc = definitionOf(ast, SRC, SRC.indexOf('d : Debounce') + 5)
  assert.equal(SRC.slice(loc.start, loc.end), 'Debounce')
  assert.equal(SRC.slice(loc.start - 15, loc.start), 'FUNCTION_BLOCK ')
  // main 里的 `d(raw := TRUE)`:raw 是 Debounce 的局部变量,在 main 里无处可跳
  assert.equal(definitionOf(ast, SRC, SRC.indexOf('d(raw := TRUE)') + 2), undefined)
  assert.equal(definitionOf(ast, SRC, SRC.indexOf(' := 1') + 1), undefined, '光标不在标识符上')
})

test('highlightsOf:声明 + 全部引用;注释与同后缀变量都不算', () => {
  const text = readSample('traffic_light.st')
  const ast = parseSt(text, 1, 'hl.st')
  const hits = highlightsOf(ast, text, text.indexOf('timer := timer + cycle_time'))
  // 1 处声明 + 9 处引用。flash_timer 出现 9 次,一次都不该混进来 ——
  // 全文正则的写法在这里必错,这条断言就是给那种改法准备的绊线。
  assert.equal(hits.length, 10)
  for (const h of hits) assert.equal(text.slice(h.start, h.end), 'timer')
})

test('highlightsOf:大小写不敏感、跨 POU 不串、FB 实例名也算引用', () => {
  const ast = parseSt(SRC, 1, 'hl2.st')
  // 声明 + `motor := raw` 各一次;注释里那次和 main 里的命名实参都不算
  assert.equal(highlightsOf(ast, SRC, SRC.indexOf('raw : BOOL')).length, 2)
  // 声明 Motor、引用 motor、引用 MOTOR 是同一个变量,三处都要亮
  assert.deepEqual(
    highlightsOf(ast, SRC, SRC.indexOf('motor := raw')).map((h) => SRC.slice(h.start, h.end)),
    ['Motor', 'motor', 'MOTOR'],
  )
  // `d(raw := TRUE)` 的实例名在 instanceName 上,不是 Variable 节点
  assert.equal(highlightsOf(ast, SRC, SRC.indexOf('d(raw')).length, 2)
})
