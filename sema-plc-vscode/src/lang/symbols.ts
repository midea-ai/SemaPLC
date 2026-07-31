// DocumentSymbolProvider:Outline 视图 / 面包屑 / `Ctrl+Shift+O` / sticky scroll 一次到手。
//
// 映射本体 outlineOf() 只吃 text + AST,不 import vscode;vscode.DocumentSymbol 的构造只在
// 文件末尾的 provider 里做。否则单测得伪造一份 TextDocument,而伪造出来的 positionAt
// 只能验证伪造品本身。
import * as vscode from 'vscode'
import { locateName, parseSt } from './ast'
import type { STAST, STProgram, STVariableDecl, SourceLocation } from './ast'

/**
 * vscode.SymbolKind 的键名。纯层用字符串,注册层 `vscode.SymbolKind[kind]` 直接取值 ——
 * 省掉一张映射表,也让纯层不必 import vscode。
 */
export type SymbolKindName = 'Module' | 'Class' | 'Function' | 'Namespace' | 'Variable' | 'Field'

export interface OutlineNode {
  name: string
  /** 跟在名字后面的灰字:类型 / 返回类型 / AT 地址。 */
  detail: string
  kind: SymbolKindName
  /** 整块范围,决定面包屑与 sticky scroll 在哪一段生效。 */
  range: SourceLocation
  /** 名字本身。点大纲条目时光标落这里 —— 落在整个 POU 上会闪一屏。 */
  selection: SourceLocation
  children: OutlineNode[]
}

const POU_KIND: Record<STProgram['programType'], SymbolKindName> = {
  PROGRAM: 'Module',
  FUNCTION_BLOCK: 'Class',
  FUNCTION: 'Function',
}

/** AST → 大纲树。三层:POU / VAR_* 块 / 每个变量名。 */
export function outlineOf(text: string, ast: STAST): OutlineNode[] {
  return ast.programs.map((p) => ({
    name: p.name,
    detail: p.returnType ?? '',
    kind: POU_KIND[p.programType],
    range: p.loc,
    selection: locateName(text, p.loc, p.name),
    children: p.varBlocks.map((b) => ({
      name: b.qualifier ? `${b.scope} ${b.qualifier}` : b.scope,
      detail: '',
      kind: 'Namespace' as SymbolKindName,
      range: b.loc,
      // 定位用 scope 而不是上面那个显示名:源码里 VAR 与 CONSTANT 之间可以有不止一个空格。
      selection: locateName(text, b.loc, b.scope),
      children: b.declarations.flatMap((d) =>
        d.names.map((name) => ({
          name,
          detail: detailOf(text, d),
          // 带 AT 地址的是 IO 点位,换个图标,一眼能从内部变量里挑出来。
          kind: (d.atAddress ? 'Field' : 'Variable') as SymbolKindName,
          // 一行声明多个名字(`a, b : INT;`)时几个符号共用整行范围,VSCode 不介意。
          range: d.loc,
          selection: locateName(text, d.loc, name),
          children: [],
        })),
      ),
    })),
  }))
}

/** `BOOL AT %IX0.0` / `ARRAY[1..8] OF INT`:类型直接切原文,省得把 ARRAY 的维度再拼一遍。 */
function detailOf(text: string, d: STVariableDecl): string {
  const type = text.slice(d.dataType.loc.start, d.dataType.loc.end).replace(/\s+/g, ' ').trim()
  const shown = type || d.dataType.typeName
  return d.atAddress ? `${shown} AT ${d.atAddress}` : shown
}

/** loc 是字符偏移,positionAt 直接换算(stripConfigurationBlock 等长替换,不需要任何修正)。 */
export function rangeOf(doc: vscode.TextDocument, loc: SourceLocation): vscode.Range {
  return new vscode.Range(doc.positionAt(loc.start), doc.positionAt(loc.end))
}

export const stSymbolProvider: vscode.DocumentSymbolProvider = {
  provideDocumentSymbols(doc) {
    const text = doc.getText()
    // parseSt 已按 (uri, version) 缓存,映射本身只是遍历,不必再缓存一层。
    return outlineOf(text, parseSt(text, doc.version, doc.uri.toString())).map((n) => toSymbol(doc, n))
  },
}

function toSymbol(doc: vscode.TextDocument, n: OutlineNode): vscode.DocumentSymbol {
  const sym = new vscode.DocumentSymbol(
    n.name,
    n.detail,
    vscode.SymbolKind[n.kind],
    rangeOf(doc, n.range),
    rangeOf(doc, n.selection),
  )
  sym.children = n.children.map((c) => toSymbol(doc, c))
  return sym
}
