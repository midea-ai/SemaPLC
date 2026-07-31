// DefinitionProvider(`F12` / `Ctrl+点击`)与 DocumentHighlightProvider(选中变量高亮全部出现)。
// 两者同吃 symbols 那份 AST,合在一个文件里省一次 parse 与一份跨包 import。
//
// 同样是纯逻辑在前、vscode 构造在后:取词用自己的 wordAt 而不是 document.getWordRangeAtPosition,
// 单测才不用伪造一个 TextDocument —— 伪造出来的取词只能验证伪造品本身。
import * as vscode from 'vscode'
import { eqName, findDeclaration, locateName, parseSt, programAt } from './ast'
import type { STAST, SourceLocation } from './ast'
import { rangeOf } from './symbols'

// ST 标识符:字母/下划线开头,后接字母数字下划线。这里不校验首字符 —— 光标落在数字上时
// 后面查不到同名声明,自然返回 undefined,多一道校验只是多一行。
const WORD_CHAR = /[A-Za-z0-9_]/

/** 光标处的标识符。offset 落在词尾(刚敲完一个名字)也算命中,与 VSCode 取词习惯一致。 */
export function wordAt(text: string, offset: number): { name: string; loc: SourceLocation } | undefined {
  let start = offset
  let end = offset
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--
  while (end < text.length && WORD_CHAR.test(text[end])) end++
  if (start === end) return undefined
  return { name: text.slice(start, end), loc: { start, end } }
}

/**
 * F12 的落点:先在光标所在 POU 可见的变量声明里找,再退回同名 POU
 * (FB 实例的类型名、函数调用点 —— 这才是 F12 最常按的地方)。
 */
export function definitionOf(ast: STAST, text: string, offset: number): SourceLocation | undefined {
  const word = wordAt(text, offset)
  if (!word) return undefined
  const scoped = findDeclaration(ast, word.name, offset)
  if (scoped) return locateName(text, scoped.decl.loc, word.name)
  const pou = ast.programs.find((p) => eqName(p.name, word.name))
  return pou ? locateName(text, pou.loc, pou.name) : undefined
}

/**
 * 光标处标识符在当前 POU 里的全部出现位置(含声明处)。
 * 走 AST 而不是全文正则:注释与字符串里的同名词不该被高亮,`flash_timer` 里的 `timer` 更不该。
 */
export function highlightsOf(ast: STAST, text: string, offset: number): SourceLocation[] {
  const word = wordAt(text, offset)
  if (!word) return []
  const out: SourceLocation[] = []
  const scoped = findDeclaration(ast, word.name, offset)
  if (scoped) out.push(locateName(text, scoped.decl.loc, word.name))
  collectRefs(programAt(ast, offset)?.statements ?? ast.topLevelStatements, word.name, text, out)
  return out
}

/**
 * 语句树里引用了 name 的位置。AST 节点全是带 loc 的普通对象,递归扫下去即可,
 * 不必为十几种语句各写一个 case —— 加一种新语句时这里不需要跟着改。
 */
function collectRefs(node: unknown, name: string, text: string, out: SourceLocation[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, name, text, out)
    return
  }
  if (!node || typeof node !== 'object') return
  const n = node as { type?: string; name?: string; accessPath?: string[]; instanceName?: string; loc?: SourceLocation }
  // `Timer1.Q` 的 name 是整条路径,被引用的变量是 accessPath[0];FB 调用的实例名在 instanceName。
  const ref =
    n.type === 'Variable' ? n.accessPath?.[0] ?? n.name : n.type === 'FunctionBlockCall' ? n.instanceName : undefined
  if (ref && n.loc && eqName(ref, name)) out.push(locateName(text, n.loc, name))
  for (const child of Object.values(n)) collectRefs(child, name, text, out)
}

export const stDefinitionProvider: vscode.DefinitionProvider = {
  provideDefinition(doc, pos) {
    const text = doc.getText()
    const loc = definitionOf(ast(doc, text), text, doc.offsetAt(pos))
    return loc ? new vscode.Location(doc.uri, rangeOf(doc, loc)) : undefined
  },
}

export const stHighlightProvider: vscode.DocumentHighlightProvider = {
  provideDocumentHighlights(doc, pos) {
    const text = doc.getText()
    return highlightsOf(ast(doc, text), text, doc.offsetAt(pos)).map(
      (loc) => new vscode.DocumentHighlight(rangeOf(doc, loc)),
    )
  },
}

function ast(doc: vscode.TextDocument, text: string): STAST {
  return parseSt(text, doc.version, doc.uri.toString())
}
