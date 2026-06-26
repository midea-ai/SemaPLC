import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState, Compartment, Annotation } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting } from '@codemirror/language'
import { structuredText } from '../../lang'
import { stHighlightStyle, stEditorTheme } from './cmSetup'

// 标记「外部(磁盘/刷新/切文件)」事务,使 updateListener 不把它回灌成用户输入。
const EXTERNAL = Annotation.define<boolean>()
const langCompartment = new Compartment()
const langExtension = (language: string) => (language === 'st' ? structuredText() : [])

export function CodeEditor({ value, language, onChange }: { value: string; language: string; onChange: (v: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // 挂载一次
  useEffect(() => {
    if (!hostRef.current) return
    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged && u.transactions.some((tr) => !tr.annotation(EXTERNAL))) {
        onChangeRef.current(u.state.doc.toString())
      }
    })
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          syntaxHighlighting(stHighlightStyle),
          langCompartment.of(langExtension(language)),
          stEditorTheme,
          updateListener,
        ],
      }),
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 外部 value 变更(磁盘应用 / 刷新 / 切文件)→ 替换文档,打 EXTERNAL 标记避免回灌
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: EXTERNAL.of(true) })
    }
  }, [value])

  // 文件类型变化 → 重配语言扩展
  useEffect(() => {
    viewRef.current?.dispatch({ effects: langCompartment.reconfigure(langExtension(language)) })
  }, [language])

  return <div ref={hostRef} className="code-cm" />
}
