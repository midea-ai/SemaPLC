// ST 的 AST 层:symbols / definition / hover / completion / diagnostics 五个 provider 的唯一入口。
//
// 刻意不 import vscode —— 入参全是原始值(text / version / key),让注册层从 TextDocument 里取。
// 这样整层可以直接单测,不必给 vscode 造壳;也避免 provider 各写一份「先剥 CONFIGURATION 再 parse」。
//
// 解析器与 AST 类型跨包复用 sema-plc-web(cst-to-ast.ts 1568 行,不可能照抄一份)。
// 这条 import 依赖 tsconfig 的 module:"Preserve" + moduleResolution:"Bundler";
// 换回 Node16 会立刻撞 TS1479/TS2835(见 tsconfig.json 里的注释)。esbuild 打包时原样内联。
import { parseSTToAST } from '../../../sema-plc-web/src/transformer/ast/cst-to-ast'
import { stripConfigurationBlock } from '../../../sema-plc-web/src/lang/st-source'
import type {
  STAST,
  STProgram,
  STVarBlock,
  STVariableDecl,
  SourceLocation,
} from '../../../sema-plc-web/src/transformer/ast/st-ast-types'

export type { STAST, STProgram, STVarBlock, STVariableDecl, SourceLocation }
export type { STStatement, STExpression, STTypeDef, ParseError } from '../../../sema-plc-web/src/transformer/ast/st-ast-types'
// 诊断通道要把「剥掉 CONFIGURATION 的源码」喂给 rusty,从这里拿,别再摸跨包路径。
export { stripConfigurationBlock }

/** 一条变量声明连同它所在的作用域,provider 展示 VAR_INPUT/VAR 之类的信息要用。 */
export interface ScopedDecl {
  decl: STVariableDecl
  block: STVarBlock
  /** 顶层 VAR_GLOBAL 块里的声明没有宿主 POU。 */
  program?: STProgram
}

// 按文档缓存。sticky scroll、补全、hover 会在同一个 version 上连打多次;
// 实测单文件 parse 是 1–18ms,不缓存也能用,只是没必要每敲一个字符重复几次。
const cache = new Map<string, { version: number; ast: STAST }>()

/**
 * 剥掉 CONFIGURATION 后解析。key 一般传 `document.uri.toString()`,version 传 `document.version`。
 *
 * 返回的 loc 是**原文档**的字符偏移:stripConfigurationBlock 做等长空白替换,不产生位移,
 * 所以调用方可以直接 `document.positionAt(node.loc.start)`,不需要任何 sourcemap。
 */
export function parseSt(text: string, version: number, key: string): STAST {
  const hit = cache.get(key)
  if (hit && hit.version === version) return hit.ast
  const ast = parseSTToAST(stripConfigurationBlock(text))
  cache.set(key, { version, ast })
  return ast
}

/** 文档关闭时调用,否则一个会话里开过的每个文件都会把整棵 AST 挂到进程结束。 */
export function forgetSt(key: string): void {
  cache.delete(key)
}

/** IEC 61131-3 的标识符大小写不敏感:`Motor` 与 `motor` 是同一个变量。 */
export function eqName(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase()
}

/** offset 落在哪个 POU 里。嵌套不存在,取第一个命中的即可。 */
export function programAt(ast: STAST, offset: number): STProgram | undefined {
  return ast.programs.find((p) => offset >= p.loc.start && offset <= p.loc.end)
}

/**
 * offset 处可见的全部变量声明:所在 POU 的 VAR_* 块 + 文件级 VAR_GLOBAL。
 * 局部在前,便于 find 时局部优先(ST 里同名局部遮蔽全局)。
 */
export function declarationsAt(ast: STAST, offset: number): ScopedDecl[] {
  const out: ScopedDecl[] = []
  const program = programAt(ast, offset)
  if (program) {
    for (const block of program.varBlocks) {
      for (const decl of block.declarations) out.push({ decl, block, program })
    }
  }
  for (const block of ast.topLevelVarBlocks) {
    for (const decl of block.declarations) out.push({ decl, block })
  }
  return out
}

/** F12 / hover 的落点:offset 处名为 name 的声明。 */
export function findDeclaration(ast: STAST, name: string, offset: number): ScopedDecl | undefined {
  return declarationsAt(ast, offset).find((s) => s.decl.names.some((n) => eqName(n, name)))
}

/**
 * 在 loc 范围内定位标识符 name 自身的位置。
 *
 * AST 只给整块的 loc(STProgram.loc 覆盖 PROGRAM…END_PROGRAM 全段,STVariableDecl.loc 覆盖整行),
 * 而大纲的 selectionRange 和 F12 的落点要的是名字那几个字符 —— 高亮整个 POU 会闪一屏。
 * 找不到就退回块首,provider 不必处理 undefined。
 */
export function locateName(text: string, loc: SourceLocation, name: string): SourceLocation {
  const scope = text.slice(loc.start, loc.end)
  // 词边界 + 大小写不敏感;name 来自 AST 而非用户输入,但仍转义,免得 FB 名里的 `.` 变成通配。
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const m = re.exec(scope)
  if (!m) return { start: loc.start, end: loc.start }
  return { start: loc.start + m.index, end: loc.start + m.index + name.length }
}
