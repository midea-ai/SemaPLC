// src/lang/hover.ts + completion.ts 的纯逻辑自检:node --test test/
// 被测的是「AST + 全文 + 光标偏移 → markdown / 候选项」这层,vscode 只在两个 provider 对象里出现,
// 这里一次都不调它 —— esbuild 把 vscode alias 成 stub 只是为了让 bundle 能跑起来。
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import * as esbuild from 'esbuild'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const here = path.dirname(fileURLToPath(import.meta.url))
const lang = path.resolve(here, '..', 'src', 'lang')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'semaplc-lang-'))

let parseSt, hoverMarkdown, completionsAt, toItem

// 真实工程的形状:AT 地址、TON 实例、成员访问、第二个 POU(它的局部变量不该泄漏到 main 里)、
// 以及 OpenPLC 硬要求的 CONFIGURATION 段。
const SRC = `PROGRAM main
VAR
    emergency_button AT %IX0.0 : BOOL := FALSE;
    motor AT %QX0.0 : BOOL;
    delay : TON;
    cycles : INT := 0;
END_VAR
delay(IN := emergency_button, PT := T#5s);
motor := delay.Q;
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

const at = (needle, after = '') => SRC.indexOf(needle) + after.length
const labels = (items) => items.map((i) => i.label)
/**
 * 用户真正看到的顺序。照抄 VSCode 的 CompletionItemComparator:两边都有 sortText 就比 sortText,
 * 缺失或打平一律回落到比 label(小写)——**数组下标它一个字都不看**。
 * 不能图省事写成 `sort(bySortText)`:JS 的 sort 是稳定的,sortText 全相等时结果恰好等于数组序,
 * 那就又变成在验一个用户看不到的顺序了(这版助手函数第一次写错就是这样,漏放了变异体)。
 */
const shown = (items) => {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  return [...items.map(toItem)].sort(
    (a, b) =>
      (a.sortText && b.sortText ? cmp(a.sortText, b.sortText) : 0) ||
      cmp(a.label.toLowerCase(), b.label.toLowerCase()),
  )
}

before(async () => {
  // toItem 要真的 new vscode.CompletionItem,而共享 stub 只覆盖 ServerManager 用到的那撮 API。
  // 就地把补全用的三个补上,不去动别人的文件。
  const vscodeStub = path.join(tmp, 'vscode.js')
  fs.writeFileSync(
    vscodeStub,
    `module.exports = Object.assign({}, require(${JSON.stringify(path.join(here, 'stub-vscode.js'))}), {\n` +
      `  CompletionItemKind: { Variable: 6, Field: 5, Class: 7, Struct: 22, Keyword: 14 },\n` +
      `  CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind } },\n` +
      `  MarkdownString: class { constructor(value) { this.value = value } },\n` +
      `})\n`,
  )

  // 一个 bundle 装两个模块:两边共用同一份 ast.ts 缓存,免得 parseSt 分身。
  const entry = path.join(tmp, 'entry.ts')
  fs.writeFileSync(
    entry,
    `export { hoverMarkdown } from ${JSON.stringify(path.join(lang, 'hover'))}\n` +
      `export { completionsAt, toItem } from ${JSON.stringify(path.join(lang, 'completion'))}\n` +
      `export { parseSt } from ${JSON.stringify(path.join(lang, 'ast'))}\n`,
  )
  const bundle = path.join(tmp, 'lang.cjs')
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    outfile: bundle,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    alias: { vscode: vscodeStub },
    logLevel: 'silent',
  })
  ;({ parseSt, hoverMarkdown, completionsAt, toItem } = createRequire(import.meta.url)(bundle))
})

const ast = () => parseSt(SRC, 1, 'hover-completion.st')

test('hover 命中静态表:签名 + 描述 + 参数表', () => {
  const md = hoverMarkdown(ast(), SRC, 'TON', at('delay : TON'))
  assert.match(md, /```st\nTON\(IN: BOOL, PT: TIME\)\n```/)
  assert.match(md, /On-delay timer/)
  assert.match(md, /\| `PT` \| TIME \|/)
  // 大小写不敏感(getSTDocumentation 已归一)
  assert.equal(hoverMarkdown(ast(), SRC, 'ton', 0), md)
})

test('hover 回落到 AST 局部变量:显示声明原文与作用域', () => {
  const md = hoverMarkdown(ast(), SRC, 'emergency_button', at('motor := delay.Q'))
  assert.match(md, /emergency_button AT %IX0\.0 : BOOL := FALSE/)
  assert.match(md, /_VAR_ · main/)
  // 别的 POU 的局部变量不在作用域里 ⇒ 不该有 hover
  assert.equal(hoverMarkdown(ast(), SRC, 'raw', at('motor := delay.Q')), undefined)
})

test('hover 直接地址', () => {
  const md = hoverMarkdown(ast(), SRC, '%IX0.0', at('motor := delay.Q'))
  assert.match(md, /输入区/)
  assert.match(md, /字节 0,位 0/)
  assert.match(hoverMarkdown(ast(), SRC, '%QW3', 0), /输出区 · 字 \(16 bit\)[\s\S]*编号 3/)
  assert.equal(hoverMarkdown(ast(), SRC, 'nonexistent_thing', 0), undefined)
})

test('补全:POU 体内给出本 POU 的声明,不给别的 POU 的', () => {
  const items = completionsAt(ast(), SRC, at('motor := delay.Q', 'motor := '))
  const names = labels(items)
  for (const n of ['emergency_button', 'motor', 'delay', 'cycles']) assert.ok(names.includes(n), n)
  assert.ok(!names.includes('raw'), 'Debounce 的 VAR_INPUT 不该出现在 main 里')
  const eb = items.find((i) => i.label === 'emergency_button')
  assert.equal(eb.detail, 'BOOL AT %IX0.0')
  assert.equal(eb.kind, 'variable')
  for (const n of ['TON', 'BOOL', 'IF']) assert.ok(names.includes(n), n)

  // 静态词表跟在局部变量后面 —— 说了算的是 sortText:不设它,VSCode 按 label 字母序重排,
  // 用户自己的变量会被埋进 ~45 条关键字中间(实测 AND/BOOL/CASE/counter/…)。
  const order = labels(shown(items))
  for (const n of ['emergency_button', 'motor', 'delay', 'cycles']) {
    assert.ok(order.indexOf(n) < order.indexOf('BOOL'), `${n} 被排到静态词表后面了`)
  }
})

test('补全:FB 实例后跟 ( 给命名参数,插入文本带 :=', () => {
  const items = completionsAt(ast(), SRC, at('delay(IN', 'delay('))
  assert.deepEqual(labels(items), ['IN', 'PT'])
  assert.equal(items[0].insertText, 'IN := ')
  assert.equal(items[0].detail, 'BOOL')
})

test('补全:参数值位置回到通用列表(参数名已经打完了)', () => {
  const names = labels(completionsAt(ast(), SRC, at('delay(IN', 'delay(IN := ')))
  assert.ok(names.includes('emergency_button'))
  assert.ok(!names.includes('PT'), '在写值,不该再提示参数名')
})

test('补全:实例名后跟 . 给成员,输出在前', () => {
  const items = completionsAt(ast(), SRC, at('delay.Q', 'delay.'))
  assert.equal(items[0].kind, 'field')
  // 断言 sortText 排出来的序,不是数组序:数组序 VSCode 一个字都不看,
  // 断言它等于在验一个用户永远看不到的顺序(不设 sortText 时真实出来的是 ET/IN/PT/Q)。
  assert.deepEqual(labels(shown(items)), ['Q', 'ET', 'IN', 'PT'])
})

test('补全:非 FB 的点访问不吞掉通用列表', () => {
  // `%IX0.` 里的 `IX0` 长得像实例名,但查不到 FB ⇒ 必须回落
  const names = labels(completionsAt(ast(), SRC, at('%IX0.0 : BOOL', '%IX0.')))
  assert.ok(names.includes('cycles'))
})
