// HoverProvider:悬停看标准 FB / 数据类型 / 关键字的文档,以及自己声明的变量与直接地址。
//
// 文件上半是纯逻辑(不碰 vscode.*),下半只做 TextDocument ↔ 纯函数的适配。
import * as vscode from 'vscode'
import { getSTDocumentation } from '../../../sema-plc-web/src/lang/st-docs'
import { findDeclaration, parseSt, type STAST } from './ast'
import { declMarkdown, docToMarkdown } from './markdown'

const AREA: Record<string, string> = { I: '输入', Q: '输出', M: '内存' }
const SIZE: Record<string, string> = {
  X: '位 (1 bit)',
  B: '字节 (8 bit)',
  W: '字 (16 bit)',
  D: '双字 (32 bit)',
  L: '长字 (64 bit)',
}

/**
 * 悬停在 word 上该显示什么 markdown,命不中返回 undefined。
 *
 * 三条路依次尝试:静态文档表 → 光标处可见的变量声明 → 直接地址。
 * word 由调用方用 `getWordRangeAtPosition` 取,language-configuration 的 wordPattern
 * 已经把 `%IX0.0` 整个算一个词,所以地址那条路拿得到完整地址而不是半截 `IX0`。
 */
export function hoverMarkdown(
  ast: STAST,
  text: string,
  word: string,
  offset: number,
): string | undefined {
  const doc = getSTDocumentation(word)
  if (doc) return docToMarkdown(doc)
  const decl = findDeclaration(ast, word, offset)
  if (decl) return declMarkdown(text, decl)
  return explainAddress(word)
}

/** `%IX0.0` → 输入区的一个位。IEC 61131-3 的直接地址:%<区><大小><层级编号>,大小缺省是位。 */
export function explainAddress(word: string): string | undefined {
  const m = /^%([IQM])([XBWDL])?(\d+(?:\.\d+)*)$/i.exec(word)
  if (!m) return undefined
  const area = AREA[m[1].toUpperCase()]
  const size = SIZE[(m[2] ?? 'X').toUpperCase()]
  const parts = m[3].split('.')
  const where = parts.length > 1 ? `字节 ${parts[0]},位 ${parts.slice(1).join('.')}` : `编号 ${parts[0]}`
  return '```st\n' + word + '\n```\n\n' + `${area}区 · ${size}\n\n${where}`
}

export const stHoverProvider: vscode.HoverProvider = {
  provideHover(document, position) {
    const range = document.getWordRangeAtPosition(position)
    if (!range) return undefined
    const text = document.getText()
    const ast = parseSt(text, document.version, document.uri.toString())
    const md = hoverMarkdown(ast, text, document.getText(range), document.offsetAt(position))
    return md ? new vscode.Hover(new vscode.MarkdownString(md), range) : undefined
  },
}
