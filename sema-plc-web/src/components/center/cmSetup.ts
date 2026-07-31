import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { EditorView } from '@codemirror/view'

// 全部取自 semaplc.css 的主题变量(--tk-* / --code-*),所以换主题时编辑器跟着换,
// 不需要重建 EditorView —— CSS 变量在 CodeMirror 生成的规则里照常级联。
export const stHighlightStyle = HighlightStyle.define([
  { tag: [t.controlKeyword, t.definitionKeyword, t.keyword, t.logicOperator], color: 'var(--tk-kw)', fontWeight: 'var(--tk-kw-weight)' },
  { tag: t.typeName, color: 'var(--tk-type)' },
  { tag: t.bool, color: 'var(--tk-type)', fontWeight: '600' },
  { tag: t.string, color: 'var(--tk-addr)' },
  { tag: t.attributeName, color: 'var(--tk-addr)', fontWeight: '600' },
  { tag: t.modifier, color: 'var(--tk-com)' },
  { tag: t.literal, color: 'var(--tk-type)' },
  { tag: t.number, color: 'var(--tk-num)' },
  { tag: [t.lineComment, t.blockComment], color: 'var(--tk-com)', fontStyle: 'italic' },
])

export const stEditorTheme = EditorView.theme(
  {
    '&': { fontSize: '12.5px', backgroundColor: 'var(--code-bg)', color: 'var(--code-text)', height: '100%' },
    '.cm-content': { fontFamily: 'var(--mono)', padding: '12px 0' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7' },
    '.cm-gutters': { backgroundColor: 'var(--code-gutter)', borderRight: '1px solid var(--line)', color: 'var(--code-ln)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 10px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
    '.cm-activeLine': { backgroundColor: 'var(--code-active)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--code-sel)' },
    '.cm-cursor': { borderLeftColor: 'var(--brand)' },
  },
  { dark: false },
)
