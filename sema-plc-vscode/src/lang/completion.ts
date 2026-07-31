// CompletionItemProvider:三个来源 —— 光标处可见的变量声明、FB 调用的命名参数、静态词表。
//
// 文件上半是纯逻辑(不碰 vscode.*):AST + 全文 + 光标偏移 → 候选项的纯数据。
// 下半只把纯数据翻成 vscode.CompletionItem。
//
// 前缀过滤故意不做:VSCode 自己按 wordPattern 取词并做大小写不敏感的模糊过滤,
// 我们再滤一遍只会和它打架(打 `mo` 匹配 `Motor` 就是它给的)。
import * as vscode from 'vscode'
import {
  DATA_TYPE_DOCS,
  FUNCTION_BLOCK_DOCS,
  KEYWORD_DOCS,
  type STDocumentation,
} from '../../../sema-plc-web/src/lang/st-docs'
import { declarationsAt, findDeclaration, parseSt, type STAST } from './ast'
import { declMarkdown, declType, docToMarkdown } from './markdown'

export type StCompletionKind = 'variable' | 'field' | 'class' | 'struct' | 'keyword'

export interface StCompletion {
  label: string
  kind: StCompletionKind
  detail?: string
  /** 命名参数要连 ` := ` 一起插;其余条目原样插 label。 */
  insertText?: string
  /** markdown 源码,注册层包成 MarkdownString。 */
  documentation?: string
}

/** 三张静态表的 key。数据不变,启动时算一次。 */
const STATIC: StCompletion[] = [
  ...fromTable(FUNCTION_BLOCK_DOCS, 'class'),
  ...fromTable(DATA_TYPE_DOCS, 'struct'),
  ...fromTable(KEYWORD_DOCS, 'keyword'),
]

/** 光标处该提示什么。 */
export function completionsAt(ast: STAST, text: string, offset: number): StCompletion[] {
  const before = text.slice(0, offset)

  // `Timer.` / `Timer.Q` —— 成员补全。`%IX0.` 也会匹配到这条(`IX0` 像标识符),
  // 但它查不到 FB 实例,自然落到下面的通用列表,不必额外挡。
  const member = /([A-Za-z_]\w*)\s*\.\s*\w*$/.exec(before)
  if (member) {
    const doc = fbDocOf(ast, member[1], offset)
    if (doc) {
      // 输出在前:`Timer.Q` 才是十有八九要打的那个。
      return [...(doc.returns ?? []), ...(doc.parameters ?? [])].map((p) => ({
        label: p.name,
        kind: 'field' as const,
        detail: p.type,
        documentation: p.description,
      }))
    }
  }

  // `Timer(` —— 命名参数补全。ST 的 FB 调用没有位置参数,只有 `IN := x` 这种形式。
  const paren = openCallParen(text, offset)
  if (paren >= 0 && !typingArgValue(text, paren, offset)) {
    const callee = /([A-Za-z_]\w*)\s*$/.exec(text.slice(0, paren))
    const doc = callee ? fbDocOf(ast, callee[1], offset) : undefined
    if (doc?.parameters?.length) {
      return doc.parameters.map((p) => ({
        label: p.name,
        kind: 'field' as const,
        detail: p.type,
        insertText: `${p.name} := `,
        documentation: p.description,
      }))
    }
  }

  return [...localVars(ast, text, offset), ...STATIC]
}

/** 实例名 → 它的类型在标准 FB 表里的文档。查不到(普通变量、函数调用)返回 undefined。 */
function fbDocOf(ast: STAST, name: string, offset: number): STDocumentation | undefined {
  const found = findDeclaration(ast, name, offset)
  return found && FUNCTION_BLOCK_DOCS[found.decl.dataType.typeName.toUpperCase()]
}

function localVars(ast: STAST, text: string, offset: number): StCompletion[] {
  return declarationsAt(ast, offset).flatMap((s) =>
    s.decl.names.map((name) => ({
      label: name,
      kind: (s.block.scope.startsWith('VAR_IN') || s.block.scope === 'VAR_OUTPUT'
        ? 'field'
        : 'variable') as StCompletionKind,
      detail: declType(text, s.decl),
      documentation: declMarkdown(text, s),
    })),
  )
}

/**
 * 光标前最近的那个未闭合 `(` 的偏移;不在调用里返回 -1。
 *
 * 遇 `;` 就停:再往前就是上一条语句的括号了。注释里的括号会误判 —— `(* … *)` 整体是配平的,
 * 只有注释里写了单个不配对的括号才会串,代价是多一屏无关候选,不值得为它引一套词法分析。
 */
function openCallParen(text: string, offset: number): number {
  let depth = 0
  for (let i = offset - 1; i >= 0; i--) {
    const c = text[i]
    if (c === ')') depth++
    else if (c === '(') {
      if (depth === 0) return i
      depth--
    } else if (c === ';') return -1
  }
  return -1
}

/**
 * 光标是不是在写某个参数的**值**(`Timer(IN := ` 的 `|` 处)。
 * 是的话要提示变量而不是参数名 —— 参数名已经打完了。
 */
function typingArgValue(text: string, paren: number, offset: number): boolean {
  const arg = text.slice(paren + 1, offset)
  return arg.slice(arg.lastIndexOf(',') + 1).includes(':=')
}

function fromTable(table: Record<string, STDocumentation>, kind: StCompletionKind): StCompletion[] {
  return Object.entries(table).map(([label, doc]) => ({
    label,
    kind,
    detail: doc.signature,
    documentation: docToMarkdown(doc),
  }))
}

/** `.` 给成员补全,`(` 给命名参数,`:` 给声明处的数据类型。 */
export const ST_COMPLETION_TRIGGERS = ['.', '(', ':']

export const stCompletionProvider: vscode.CompletionItemProvider = {
  provideCompletionItems(document, position) {
    const text = document.getText()
    const ast = parseSt(text, document.version, document.uri.toString())
    return completionsAt(ast, text, document.offsetAt(position)).map(toItem)
  },
}

export function toItem(c: StCompletion, i: number): vscode.CompletionItem {
  // 枚举在函数里取而不是模块顶层:测试把 vscode 换成 stub,顶层取值会在 import 期就炸。
  const kinds: Record<StCompletionKind, vscode.CompletionItemKind> = {
    variable: vscode.CompletionItemKind.Variable,
    field: vscode.CompletionItemKind.Field,
    class: vscode.CompletionItemKind.Class,
    struct: vscode.CompletionItemKind.Struct,
    keyword: vscode.CompletionItemKind.Keyword,
  }
  const item = new vscode.CompletionItem(c.label, kinds[c.kind])
  // 不给 sortText,VSCode 一律按 label 字母序重排:上面「输出在前」和「局部变量排在静态词表前」
  // 两处排序意图全部作废(实测 Timer. 出来的是 ET/IN/PT/Q,自己的变量埋在 ~45 条关键字中间)。
  // 宽度取 4 而不是 3:大工程一个 POU 几百条声明并不罕见,越过 999 时 '1000' 会排到 '999' 前面。
  item.sortText = String(i).padStart(4, '0')
  if (c.detail) item.detail = c.detail
  if (c.insertText) item.insertText = c.insertText
  if (c.documentation) item.documentation = new vscode.MarkdownString(c.documentation)
  return item
}
