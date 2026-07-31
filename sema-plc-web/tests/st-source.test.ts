import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { stripConfigurationBlock } from '../src/lang/st-source'
import { parseSTToAST } from '../src/transformer/ast/cst-to-ast'

// 多 POU:旧实现「截断到第一个 END_PROGRAM」会把整个 FB 吞掉。
const MULTI_POU = `PROGRAM main
VAR
    run : BOOL;
END_VAR
run := TRUE;
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

// 纯 FB 库文件:没有 END_PROGRAM ⇒ 旧正则不匹配 ⇒ CONFIGURATION 原样送进 lezer。
const FB_ONLY = `FUNCTION_BLOCK Latch
VAR_INPUT
    s : BOOL;
    r : BOOL;
END_VAR
VAR_OUTPUT
    q : BOOL;
END_VAR
IF s THEN
    q := TRUE;
END_IF
IF r THEN
    q := FALSE;
END_IF
END_FUNCTION_BLOCK

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
END_RESOURCE
END_CONFIGURATION
`

const CFG_AT = MULTI_POU.indexOf('CONFIGURATION')

// 导出工具/手写文件会把整段 CONFIGURATION 缩进,开头锚点必须容忍前导空白。
const INDENTED = MULTI_POU.slice(0, CFG_AT) + MULTI_POU.slice(CFG_AT).replace(/^(?=.)/gm, '    ')

// ST 关键字大小写不敏感,正则的 `i` 标志掉了就会静默漏剥。
const LOWERCASE = MULTI_POU.slice(0, CFG_AT) + MULTI_POU.slice(CFG_AT).toLowerCase()

// 两段 CONFIGURATION 中间夹着 POU:`g` 标志掉了只剥第一段,
// 而懒惰量词若不懒则第一段会一路吞到第二段的 END_CONFIGURATION,把中间的 FB 一起抹掉。
const TWO_CONFIG = MULTI_POU.replace(
  'FUNCTION_BLOCK Debounce',
  `CONFIGURATION ConfigA
RESOURCE ResA ON PLC
    TASK taskA(INTERVAL := TIME#20ms, PRIORITY := 1);
END_RESOURCE
END_CONFIGURATION

FUNCTION_BLOCK Debounce`,
)

// 行尾注释后跟垃圾字符,且后文的 POU 里还有一个块注释 —— 这是回溯吞后文的复现场景:
// 用 `(\*[\s\S]*?\*)` 时正则会跳过 `junk` 一路匹配到 `(* b *)`,把 FUNCTION_BLOCK 头抹掉。
const CROSS_LINE_TAIL = `PROGRAM main
VAR
    run : BOOL;
END_VAR
run := TRUE;
END_PROGRAM

CONFIGURATION Config0
RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := TIME#100ms, PRIORITY := 0);
    PROGRAM instance0 WITH task0 : main;
END_RESOURCE
END_CONFIGURATION (* a *) junk

FUNCTION_BLOCK Debounce
VAR_INPUT
    raw : BOOL;
END_VAR
VAR_OUTPUT
    clean : BOOL;
END_VAR
(* b *)
clean := raw;
END_FUNCTION_BLOCK
`

describe('stripConfigurationBlock', () => {
  it('保住 CONFIGURATION 之外的全部 POU(旧实现在这里丢 FB)', () => {
    const ast = parseSTToAST(stripConfigurationBlock(MULTI_POU))
    expect(ast.programs.map((p) => p.name)).toEqual(['main', 'Debounce'])
    expect(ast.programs).toHaveLength(2)
    expect(ast.programs[1].programType).toBe('FUNCTION_BLOCK')
  })

  it('纯 FB 文件(无 END_PROGRAM)剥离后 0 errors', () => {
    expect(parseSTToAST(FB_ONLY).errors.length).toBeGreaterThan(0) // 不剥就是一堆假错
    expect(parseSTToAST(stripConfigurationBlock(FB_ONLY)).errors).toEqual([])
  })

  it('等长替换:长度、行数、CONFIGURATION 之前的字符逐一不变', () => {
    for (const src of [MULTI_POU, FB_ONLY]) {
      const out = stripConfigurationBlock(src)
      expect(out).toHaveLength(src.length)
      expect(out.split('\n')).toHaveLength(src.split('\n').length)
      // 被抹掉的只有 CONFIGURATION 段本身
      const cfg = src.indexOf('CONFIGURATION')
      expect(out.slice(0, cfg)).toBe(src.slice(0, cfg))
      expect(out.slice(cfg).trim()).toBe('')
    }
  })

  it('AST 的 loc 直接指回原文,不需要偏移修正', () => {
    const src = MULTI_POU
    const ast = parseSTToAST(stripConfigurationBlock(src))
    const fb = ast.programs[1]
    expect(src.slice(fb.loc.start, fb.loc.end)).toContain('FUNCTION_BLOCK Debounce')
    // 行号也对齐:FB 声明在原文第 8 行(1-based)
    expect(src.slice(0, fb.loc.start).split('\n').length).toBe(8)
  })

  it('CRLF 文件同样能剥(Windows 下写出来的 .st)', () => {
    const crlf = MULTI_POU.replace(/\n/g, '\r\n')
    const out = stripConfigurationBlock(crlf)
    expect(out).toHaveLength(crlf.length)
    expect(out.slice(crlf.indexOf('CONFIGURATION')).trim()).toBe('')
  })

  // 每条都断言同三件事:剥净、POU 完好、等长(长度与行数不变)。
  // 尾注释两条是全有全无的边界 —— 尾巴上多一个字符就整段不剥,幽灵错一条不少地全回来。
  it.each([
    ['END_CONFIGURATION 同行带块注释', MULTI_POU.replace('END_CONFIGURATION', 'END_CONFIGURATION (* done *)')],
    ['END_CONFIGURATION 同行带行注释', MULTI_POU.replace('END_CONFIGURATION', 'END_CONFIGURATION; // done')],
    ['缩进的 CONFIGURATION', INDENTED],
    ['一个文件里两个 CONFIGURATION', TWO_CONFIG],
    ['小写 configuration', LOWERCASE],
  ])('%s:剥净、POU 完好、等长', (_, src) => {
    const out = stripConfigurationBlock(src)
    expect(out).toHaveLength(src.length)
    expect(out.split('\n')).toHaveLength(src.split('\n').length)
    expect(out).not.toMatch(/CONFIGURATION/i) // 剥净:一段都没漏
    const ast = parseSTToAST(out)
    expect(ast.errors).toEqual([])
    expect(ast.programs.map((p) => p.name)).toEqual(['main', 'Debounce'])
  })

  // 跨行块注释不支持是有意的:允许跨行就等于允许回溯吞掉后文(见 st-source.ts 的注释)。
  // 这里断言的是安全行为 —— 整段不剥、原样返回,后面的 FUNCTION_BLOCK 一个字符没动。
  it('END_CONFIGURATION 后跟跨行块注释:整段不剥,绝不吞掉后面的 POU', () => {
    expect(stripConfigurationBlock(CROSS_LINE_TAIL)).toBe(CROSS_LINE_TAIL)
    // 退化成不剥 ⇒ CONFIGURATION 原样送 lezer ⇒ 幽灵错回来,但后半个文件还在
    expect(parseSTToAST(stripConfigurationBlock(CROSS_LINE_TAIL)).errors.length).toBeGreaterThan(0)
  })

  it('CONFIGURATION 没写完(边打字的中间态)时原样返回,不吞后文', () => {
    const partial = 'PROGRAM p\nEND_PROGRAM\n\nCONFIGURATION Config0\nRESOURCE Res0 ON PLC\n'
    expect(stripConfigurationBlock(partial)).toBe(partial)
  })

  it('真实样本剥完 0 errors', () => {
    for (const f of ['simple_counter.st', 'simple_counter_fixed.st', 'traffic_light.st']) {
      const src = readFileSync(new URL(`../../sema-plc-tools/runtime/samples/${f}`, import.meta.url), 'utf8')
      const ast = parseSTToAST(stripConfigurationBlock(src))
      expect(ast.errors, f).toEqual([])
      expect(ast.programs.length, f).toBeGreaterThan(0)
    }
  })
})
