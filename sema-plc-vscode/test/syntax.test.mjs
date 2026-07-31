// syntaxes/ 与 snippets/ 的声明式资产自检:node --test test/
// 这三份 JSON 没有一行代码跑得到它们 —— VSCode 解析失败时是**静默丢规则**:
// 折叠正则写成 `(?i)^...` 不报错、schema 也不红,只是折叠三角永远不出现。
// 所以正确性只能在这里守:每条正则能构造 + 在真实样本上 start/end 配得上对。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const extRoot = path.resolve(here, '..')
const samplesDir = path.resolve(extRoot, '..', 'sema-plc-tools', 'runtime', 'samples')

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const langCfg = readJson(path.join(extRoot, 'syntaxes', 'language-configuration.json'))
const grammar = readJson(path.join(extRoot, 'syntaxes', 'st.tmLanguage.json'))
const snippets = readJson(path.join(extRoot, 'snippets', 'st.json'))

/** IRegExp(`{pattern,flags}`)→ RegExp,同时就是「能不能构造」的判据。 */
const toRegExp = (ir) => (typeof ir === 'string' ? new RegExp(ir) : new RegExp(ir.pattern, ir.flags))

/** 把 language-configuration 里所有 IRegExp 摊平成 [路径, 值]。 */
function collectRegexes(node, at = '') {
  if (node && typeof node === 'object' && typeof node.pattern === 'string') return [[at, node]]
  if (node && typeof node === 'object')
    return Object.entries(node).flatMap(([k, v]) => (k === 'comment' ? [] : collectRegexes(v, `${at}.${k}`)))
  return []
}

// ---------------------------------------------------------------- 折叠规则

test('language-configuration 里每条正则都能被 new RegExp 构造', () => {
  const all = collectRegexes(langCfg)
  assert.ok(all.length >= 4, `至少应有 indentationRules 两条 + folding 两条,实得 ${all.length}`)
  for (const [at, ir] of all) {
    assert.doesNotThrow(() => toRegExp(ir), `${at} 构造失败`)
    // JS 只认 ES2025 的 `(?i:...)` 修饰符组,裸 `(?i)` 前缀直接抛 Invalid group。
    assert.ok(!ir.pattern.includes('(?i)'), `${at} 用了 (?i),JS 正则不支持,大小写得走 flags`)
  }
})

test('folding.markers 存在,且 start/end 同为 i —— VSCode 只在 flags 相同时才合并成一条正则', () => {
  const m = langCfg.folding?.markers
  assert.ok(m, 'folding.markers 缺失 = 退化成按缩进折叠,而真实 ST 的 POU 体常在第 0 列')
  assert.equal(m.start.flags, 'i')
  assert.equal(m.end.flags, 'i')
})

/**
 * 只做一件事:把两条 marker 正则当括号,自底向上做**配对**,报出配不上的那些。
 *
 * 它**不是** VSCode `computeRanges` 的复刻,不要拿它的输出当折叠区间来读:真算法还会掺进
 * 按缩进推出来的区间(同一份 traffic_light.st 真算法 18 个,这里 12 个),收尾也不是
 * `pending.pop()` 而是在栈里找 `indent === -2` 的哨兵。两者只在「标记配不配得平」上一致。
 * 折叠区间长什么样,证据在宿主实跑,不在这个文件 —— 这里守的是 JSON 里那两条正则
 * **在哪些行触发、嵌套有没有交叉**,那才是改 pattern 时真会写错、且静默失效的部分。
 */
function markerPairs(text) {
  const { start, end } = langCfg.folding.markers
  const re = new RegExp(`(${toRegExp(start).source})|(?:${toRegExp(end).source})`, start.flags)
  const lines = text.split('\n')
  const pending = [] // 尚未配对的 end 行号
  const pairs = []
  const danglingStarts = []
  for (let line = lines.length; line > 0; line--) {
    const m = re.exec(lines[line - 1])
    if (!m) continue
    if (m[1]) {
      if (pending.length) pairs.push([line, pending.pop()])
      else danglingStarts.push(line)
    } else {
      pending.push(line)
    }
  }
  return { pairs, danglingStarts, danglingEnds: pending, lines }
}

for (const name of fs.readdirSync(samplesDir).filter((f) => f.endsWith('.st'))) {
  test(`样本 ${name}:折叠标记全部配对,POU / VAR / CONFIGURATION 的起止各自配成一对`, () => {
    const { pairs, danglingStarts, danglingEnds, lines } = markerPairs(
      fs.readFileSync(path.join(samplesDir, name), 'utf8'),
    )
    assert.deepEqual(danglingStarts, [], '有起点配不到收尾')
    assert.deepEqual(danglingEnds, [], '有收尾配不到起点(会被上一层抢走,折叠错层)')

    const lineOf = (kw) => lines.findIndex((l) => l.trim().toUpperCase().startsWith(kw)) + 1
    const has = (a, b) => pairs.some(([s, e]) => s === a && e === b)
    assert.ok(has(1, lineOf('END_PROGRAM')), 'PROGRAM 的起止应配成一对')
    assert.ok(has(lineOf('CONFIGURATION'), lineOf('END_CONFIGURATION')), 'CONFIGURATION 的起止应配成一对')
    assert.ok(has(lineOf('VAR'), lineOf('END_VAR')), 'VAR 段的起止应配成一对')
  })
}

test('CONFIGURATION 里的 PROGRAM 实例化语句不算折叠起点 —— 它没有 END_PROGRAM', () => {
  const src = ['CONFIGURATION Config0', 'RESOURCE Res0 ON PLC', '  PROGRAM inst WITH t : prog;', 'END_RESOURCE', 'END_CONFIGURATION'].join('\n')
  const { danglingStarts, danglingEnds } = markerPairs(src)
  assert.deepEqual([danglingStarts, danglingEnds], [[], []])
})

test('ELSIF 不算起点:一个 IF 只有一个 END_IF', () => {
  const { danglingStarts, danglingEnds } = markerPairs('IF a THEN\nELSIF b THEN\nELSE\nEND_IF\n')
  assert.deepEqual([danglingStarts, danglingEnds], [[], []])
})

test('单行 IF 两边都不匹配,一个标记都不触发', () => {
  const { pairs, danglingStarts, danglingEnds } = markerPairs('IF a THEN b := 1; END_IF;\n')
  assert.deepEqual([pairs, danglingStarts, danglingEnds], [[], [], []])
})

test('REPEAT 由 UNTIL 收尾,单行/分行写 END_REPEAT 都平衡', () => {
  for (const src of ['REPEAT\n\tx := x + 1;\nUNTIL x > 5 END_REPEAT;\n', 'REPEAT\n\tx := x + 1;\nUNTIL x > 5\nEND_REPEAT;\n']) {
    // 平衡本身就是判据:END_REPEAT 一旦也被数成 end,就会多出一个配不到起点的收尾。
    const { danglingStarts, danglingEnds } = markerPairs(src)
    assert.deepEqual([danglingStarts, danglingEnds], [[], []], src)
  }
})

test('小写关键字同样触发标记(flags:"i")', () => {
  const { pairs } = markerPairs('program main\nvar\n\tx : BOOL;\nend_var\nend_program\n')
  assert.ok(
    pairs.some(([s, e]) => s === 1 && e === 5),
    '小写 program/end_program 应配上对',
  )
})

test('TYPE / STRUCT:STRUCT 通常写成 `Name : STRUCT`,不在行首', () => {
  const { pairs, danglingStarts, danglingEnds } = markerPairs('TYPE\n\tMyRec : STRUCT\n\t\ta : INT;\n\tEND_STRUCT;\nEND_TYPE\n')
  assert.deepEqual([danglingStarts, danglingEnds], [[], []])
  assert.ok(pairs.some(([s, e]) => s === 2 && e === 4), 'STRUCT 与 END_STRUCT 应配成一对')
})

// ---------------------------------------------------------------- tmLanguage

test('tmLanguage 每条 match/begin/end 都是合法正则', () => {
  const pats = []
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    for (const k of ['match', 'begin', 'end']) if (typeof n[k] === 'string') pats.push(n[k])
    Object.values(n).forEach(walk)
  }
  walk(grammar)
  assert.ok(pats.length > 15)
  for (const p of pats) {
    // grammar 跑在 Oniguruma 上,`(?i)` 前缀在那边合法、在 JS 里非法 —— 剥掉再验其余部分。
    assert.doesNotThrow(() => new RegExp(p.replace(/^\(\?i\)/, ''), 'i'), p)
  }
})

test('POU 声明处的名字有 scope,且规则排在 #keyword 之前', () => {
  const order = grammar.patterns.map((p) => p.include)
  assert.ok(
    order.indexOf('#pou-declaration') >= 0 && order.indexOf('#pou-declaration') < order.indexOf('#keyword'),
    '排在 #keyword 之后会被关键字规则先吃掉',
  )
  const rule = grammar.repository['pou-declaration']
  assert.equal(rule.captures['3'].name, 'entity.name.type.st')
  const re = new RegExp(rule.match.replace(/^\(\?i\)/, ''), 'i')
  assert.equal('PROGRAM traffic_light'.match(re)[3], 'traffic_light')
  assert.equal('FUNCTION_BLOCK Motor EXTENDS Base'.match(re)[3], 'Motor')
  assert.equal('METHOD PUBLIC Run : BOOL'.match(re)[3], 'Run')
  assert.equal('END_PROGRAM'.match(re), null, 'END_PROGRAM 不该被当成声明')
})

// ---------------------------------------------------------------- snippets

test('snippets 用 VSCode 的 ${1:name} 占位符,不是 CodeMirror 的 ${name}', () => {
  const entries = Object.entries(snippets)
  assert.equal(entries.length, 9, '对齐 st-language.ts 的 9 条')
  for (const [label, s] of entries) {
    assert.equal(typeof s.prefix, 'string', `${label} 缺 prefix`)
    assert.ok(Array.isArray(s.body) && s.body.length, `${label} 的 body 应是行数组`)
    const text = s.body.join('\n')
    assert.ok(!/\$\{(?!\d)/.test(text), `${label} 还留着 CodeMirror 的 \${name} 写法`)
    assert.ok(/\$(?:\d|\{\d)/.test(text), `${label} 一个跳位点都没有`)
  }
})

test('snippets 产出的代码里折叠标记自身配平', () => {
  for (const [label, s] of Object.entries(snippets)) {
    const { danglingStarts, danglingEnds } = markerPairs(s.body.join('\n').replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, ''))
    assert.deepEqual([danglingStarts, danglingEnds], [[], []], label)
  }
})
