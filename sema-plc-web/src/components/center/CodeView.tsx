import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../store/editor'
import { useLogsStore } from '../../store/logs'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT } from '../../i18n'
import { CodeEditor } from './CodeEditor'

const langOf = (path: string) => {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'st') return 'st'
  if (ext === 'yaml' || ext === 'yml') return 'yaml'
  if (ext === 'json') return 'json'
  if (ext === 'toml') return 'toml'
  return 'st'
}
const LANG_LABEL: Record<string, string> = { st: 'IEC 61131-3 · ST', yaml: 'YAML', json: 'JSON', toml: 'TOML' }
const extClass = (path: string) => ({ st: 'ext-st', yaml: 'ext-yaml', toml: 'ext-toml', json: 'ext-json' }[langOf(path)] || '')
// heuristic markers (no server metadata): generated globals, single-source io map
const isGen = (p: string) => /globals\/|gvl_|glue|\.merged\./i.test(p)
const isSot = (p: string) => /io_map|io_mapping/i.test(p)

// ── file tree ──
interface TreeFile { path: string }
interface TreeNode { name: string; dir: boolean; file?: TreeFile; children: TreeNode[] }
function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: 'workspace', dir: true, children: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1
      let child = node.children.find((c) => c.name === part)
      if (!child) { child = isFile ? { name: part, dir: false, file: { path }, children: [] } : { name: part, dir: true, children: [] }; node.children.push(child) }
      node = child
    })
  }
  return root
}

const ICON_FOLDER = <svg width="14" height="14" viewBox="0 0 16 16"><path d="M1.5 3.5h4l1.2 1.4H14.5v8H1.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
const ICON_FILE = <svg width="13" height="13" viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9.3 1.6v3.2h3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>

function Tree({ node, depth, active, onSelect }: { node: TreeNode; depth: number; active: string | null; onSelect: (p: string) => void }) {
  const t = useT()
  if (node.dir) {
    return (
      <>
        {depth >= 0 && <div className="tree-row folder" style={{ paddingLeft: 8 + depth * 14 }}><span className="tree-ic folder-ic">{ICON_FOLDER}</span>{node.name}</div>}
        {node.children.map((c, i) => <Tree key={i} node={c} depth={depth + 1} active={active} onSelect={onSelect} />)}
      </>
    )
  }
  const p = node.file!.path
  return (
    <button className={'tree-row file' + (active === p ? ' active' : '')} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onSelect(p)}>
      <span className={'tree-ic file-ic ' + extClass(p)}>{ICON_FILE}</span>
      <span className="tree-fname">{node.name}</span>
      {isSot(p) && <span className="tree-badge sot" title={t('code.badge.sot')}>★</span>}
      {isGen(p) && <span className="tree-badge gen" title={t('code.badge.gen')}>⚙</span>}
    </button>
  )
}

export function CodeView() {
  const t = useT()
  const files = useEditorStore((s) => s.files)
  const currentPath = useEditorStore((s) => s.currentPath)
  const stCode = useEditorStore((s) => s.stCode)
  const isDirty = useEditorStore((s) => s.isDirty)
  const diskChanged = useEditorStore((s) => s.diskChanged)
  const setStCode = useEditorStore((s) => s.setStCode)
  const refresh = useEditorStore((s) => s.refresh)
  const appendLog = useLogsStore((s) => s.append)
  const { send } = useWsConnection()
  const [checking, setChecking] = useState(false)
  const [treeOpen, setTreeOpen] = useState(true)

  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files])
  const lang = currentPath ? langOf(currentPath) : 'st'
  const lineCount = stCode ? stCode.split('\n').length : 0

  // 未保存草稿时,关/刷新整页给浏览器原生确认
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isDirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const onSelectFile = (p: string) => {
    if (p === currentPath) return
    if (isDirty && !window.confirm(t('code.confirm.discardSwitch'))) return
    send({ type: 'editor:open', path: p })
  }

  const onSave = () => {
    if (!isDirty || !currentPath) return
    send({ type: 'editor:save', path: currentPath, stCode })
  }

  const onCheck = async () => {
    if (!stCode.trim() || checking) return
    setChecking(true)
    appendLog({ ts: Date.now(), source: 'tool', level: 'info', message: '→ plc_check (rusty)' })
    try {
      const r = await fetch('/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stCode }) })
      const j = await r.json()
      if (j.errorMessage) appendLog({ ts: Date.now(), source: 'tool', level: 'error', message: `✗ plc_check: ${j.errorMessage}` })
      else if (j.ok) appendLog({ ts: Date.now(), source: 'tool', level: 'info', message: '✓ plc_check: rusty check passed' })
      else {
        appendLog({ ts: Date.now(), source: 'tool', level: 'error', message: `✗ plc_check: ${j.errors?.length ?? 0} error(s)` })
        for (const e of (j.errors ?? [])) {
          const loc = e.line != null ? ` (line ${e.line}${e.col != null ? `:${e.col}` : ''})` : ''
          appendLog({ ts: Date.now(), source: 'tool', level: 'error', message: `  ${e.code}${loc} ${e.message}` })
        }
      }
    } catch (e) {
      appendLog({ ts: Date.now(), source: 'tool', level: 'error', message: `✗ plc_check: ${String(e)}` })
    } finally { setChecking(false) }
  }

  return (
    <div className="code-view2">
      {treeOpen && (
        <div className="code-tree">
          <div className="tree-head">
            {t('code.tree.head')}
            <button className="tree-toggle" onClick={() => setTreeOpen(false)} title={t('code.tree.collapse')}>
              <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 8 8)" /></svg>
            </button>
          </div>
          {files.length === 0
            ? <div style={{ padding: '8px', fontSize: 12, color: 'var(--text-3)' }}>{t('code.tree.empty')}</div>
            : <Tree node={tree} depth={-1} active={currentPath} onSelect={onSelectFile} />}
        </div>
      )}
      <div className="code-main">
        <div className="code-filebar">
          {!treeOpen && (
            <button className="tree-expand-btn" onClick={() => setTreeOpen(true)} title={t('code.tree.expand')}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4l1.2 1.4H14.5v8H1.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            </button>
          )}
          <span className="code-fname">{currentPath ?? t('code.filebar.noFile')}</span>
          <div className="code-meta">
            {currentPath && <span>{LANG_LABEL[lang]} · {t('code.meta.lineCount', { count: lineCount })}</span>}
            {currentPath && isDirty && <span className="code-dirty" title={t('code.unsaved')}>●</span>}
            {currentPath && diskChanged && <span className="code-diskchanged" title={t('code.diskChanged.tooltip')}>⚠ {t('code.diskChanged')}</span>}
            {currentPath && (
              <button className={'code-btn' + (diskChanged && isDirty ? ' warn' : '')} onClick={onSave} disabled={!isDirty}
                title={diskChanged ? t('code.save.overwriteTooltip') : t('code.save.tooltip')}>
                {t('code.save')}
              </button>
            )}
            {currentPath && (
              <button className="code-btn" onClick={refresh} title={t('code.refresh.tooltip')}>{t('code.refresh')}</button>
            )}
            <button className="code-check" onClick={onCheck} disabled={checking || !stCode.trim()} title={t('code.check.tooltip')}>
              {checking ? t('code.check.checking') : t('code.check.label')}
            </button>
          </div>
        </div>
        {currentPath ? (
          <CodeEditor value={stCode} language={lang} onChange={setStCode} />
        ) : (
          <div className="code-emptyfile">{t('code.emptyFile')}</div>
        )}
      </div>
    </div>
  )
}
