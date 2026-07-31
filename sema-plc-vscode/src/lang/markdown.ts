// st-docs.ts 的 486 行数据原样跨包复用,只换掉格式化:它的 formatDocumentationHTML 产 HTML
// (给 CodeMirror 的 tooltip 用的),VSCode 的 hover / completion 要的是 markdown。
//
// 这里返回**字符串**而不是 vscode.MarkdownString —— 这层不 import vscode,注册层各包一下即可,
// 单测就不必给 vscode 造壳。
import type { STDocumentation } from '../../../sema-plc-web/src/lang/st-docs'
import type { ScopedDecl, STVariableDecl } from './ast'

/** 标准 FB / 数据类型 / 关键字的文档条目 → hover 与 completion 共用的 markdown。 */
export function docToMarkdown(doc: STDocumentation): string {
  const blocks: string[] = []
  if (doc.signature) blocks.push(fence(doc.signature))
  blocks.push(doc.description)
  if (doc.parameters?.length) blocks.push(table('参数', doc.parameters))
  if (doc.returns?.length) blocks.push(table('输出', doc.returns))
  if (doc.example) blocks.push(fence(doc.example))
  if (doc.seeAlso?.length) blocks.push(`另见:${doc.seeAlso.join('、')}`)
  return blocks.join('\n\n')
}

/**
 * 悬停在自己声明的变量上时显示的东西。
 *
 * 直接切原文而不是把 names/dataType/atAddress 重新拼一遍:声明行怎么写的就怎么显示
 * (`a, b : ARRAY[1..3] OF INT := ...` 这类拼不回去的写法也白送),而且少一份会和语法漂移的格式化代码。
 */
export function declMarkdown(text: string, s: ScopedDecl): string {
  const src = text.slice(s.decl.loc.start, s.decl.loc.end).trim().replace(/;$/, '')
  const scope = s.block.qualifier ? `${s.block.scope} ${s.block.qualifier}` : s.block.scope
  return `${fence(src)}\n\n_${scope}_ · ${s.program ? s.program.name : '文件级'}`
}

/** completion 条目的 detail:`BOOL AT %IX0.0`。 */
export function declType(text: string, d: STVariableDecl): string {
  // dataType.loc 在缺 TypeSpec 时(边打字边补全,`x : ` 还没写完)退化成整条声明的 loc,
  // 切出来会带上变量名和冒号 —— 这时用解析器给的 typeName 兜底。
  const slice = text.slice(d.dataType.loc.start, d.dataType.loc.end).trim()
  const type = !slice || slice.includes(':') ? d.dataType.typeName : slice
  return d.atAddress ? `${type} AT ${d.atAddress}` : type
}

function fence(code: string): string {
  return '```st\n' + code + '\n```'
}

function table(title: string, rows: { name: string; type: string; description: string }[]): string {
  return [
    `**${title}**`,
    '',
    '| 名称 | 类型 | 说明 |',
    '| --- | --- | --- |',
    // 说明里出现 `|` 会把表格切成多列,转义掉
    ...rows.map((r) => `| \`${r.name}\` | ${r.type} | ${r.description.replace(/\|/g, '\\|')} |`),
  ].join('\n')
}
