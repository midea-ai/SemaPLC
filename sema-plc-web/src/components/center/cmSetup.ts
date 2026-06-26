import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { EditorView } from '@codemirror/view'

// 配色对齐现有只读高亮(semaplc.css .tk-*):kw #8B5CF6 / type #0E9F9F /
// string #C2410C / time #0369A1 / num #2563EB / bool #0E9F9F / comment #9AA1AD。
export const stHighlightStyle = HighlightStyle.define([
  { tag: [t.controlKeyword, t.definitionKeyword, t.keyword, t.logicOperator], color: '#8B5CF6', fontWeight: '600' },
  { tag: t.typeName, color: '#0E9F9F' },
  { tag: t.bool, color: '#0E9F9F', fontWeight: '600' },
  { tag: t.string, color: '#C2410C' },
  { tag: t.literal, color: '#0369A1' },
  { tag: t.number, color: '#2563EB' },
  { tag: [t.lineComment, t.blockComment], color: '#9AA1AD', fontStyle: 'italic' },
])

// 浅色主题,贴合 .code-view2(#FBFBFC)/.code-pre(12.5px/1.7/var(--mono))/.ln-no(#c2c7d0)。
export const stEditorTheme = EditorView.theme(
  {
    '&': { fontSize: '12.5px', backgroundColor: '#FBFBFC', color: '#384150', height: '100%' },
    '.cm-content': { fontFamily: 'var(--mono)', padding: '12px 0' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7' },
    '.cm-gutters': { backgroundColor: '#FBFBFC', border: 'none', color: '#c2c7d0' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 14px 0 10px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,.02)' },
  },
  { dark: false },
)
