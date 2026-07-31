import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../store/editor'
import { useLogsStore } from '../../store/logs'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT } from '../../i18n'
import { confirmDialog, vscodeApi } from '../../lib/confirmDialog'
import { stripConfigurationBlock } from '../../lang/st-source'
import { CodeEditor } from './CodeEditor'

// 页面/面板被隐藏时暂存未保存草稿的键(见下方 visibilitychange)
const DRAFT_KEY = 'semaplc:draft'

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
interface TreeNode { name: string; path: string; dir: boolean; file?: TreeFile; children: TreeNode[] }
export function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: 'workspace', path: '', dir: true, children: [] }
  for (const path of paths) {
    const parts = path.split('/')
    let node = root
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        const p = parts.slice(0, i + 1).join('/')
        child = isFile ? { name: part, path: p, dir: false, file: { path }, children: [] } : { name: part, path: p, dir: true, children: [] }
        node.children.push(child)
      }
      node = child
    })
  }
  // 目录在前,同类按名排序
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    n.children.forEach(sort)
  }
  sort(root)
  return root
}
/** 某文件路径的所有祖先目录 */
export const ancestorDirs = (path: string) => path.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))

const ICON_FOLDER = <svg width="14" height="14" viewBox="0 0 16 16"><path d="M1.5 3.5h4l1.2 1.4H14.5v8H1.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
const ICON_FILE = <svg width="13" height="13" viewBox="0 0 16 16"><path d="M3.5 1.5h6l3 3v10h-9z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9.3 1.6v3.2h3" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
const ICON_CARET = <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>

function Tree({ node, depth, active, collapsed, onSelect, onToggle }: {
  node: TreeNode; depth: number; active: string | null
  collapsed: Set<string>; onSelect: (p: string) => void; onToggle: (p: string) => void
}) {
  const t = useT()
  if (node.dir) {
    const isCollapsed = depth >= 0 && collapsed.has(node.path)
    return (
      <>
        {depth >= 0 && (
          <button className="tree-row folder" style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => onToggle(node.path)} aria-expanded={!isCollapsed} title={node.path}>
            <span className={'tree-caret' + (isCollapsed ? '' : ' open')}>{ICON_CARET}</span>
            <span className="tree-ic folder-ic">{ICON_FOLDER}</span>
            <span className="tree-fname">{node.name}</span>
          </button>
        )}
        {!isCollapsed && node.children.map((c) => (
          <Tree key={c.path} node={c} depth={depth + 1} active={active} collapsed={collapsed} onSelect={onSelect} onToggle={onToggle} />
        ))}
      </>
    )
  }
  const p = node.file!.path
  return (
    <button className={'tree-row file' + (active === p ? ' active' : '')} style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(p)} title={p}>
      <span className="tree-caret" aria-hidden="true" />
      <span className={'tree-ic file-ic ' + extClass(p)}>{ICON_FILE}</span>
      <span className="tree-fname">{node.name}</span>
      {isSot(p) && <span className="tree-badge sot" title={t('code.badge.sot')}>★</span>}
      {isGen(p) && <span className="tree-badge gen" title={t('code.badge.gen')}>⚙</span>}
    </button>
  )
}

export function CodeView({ defaultTreeOpen = true }: { defaultTreeOpen?: boolean } = {}) {
  const t = useT()
  const files = useEditorStore((s) => s.files)
  const currentPath = useEditorStore((s) => s.currentPath)
  const stCode = useEditorStore((s) => s.stCode)
  const isDirty = useEditorStore((s) => s.isDirty)
  const diskContent = useEditorStore((s) => s.diskContent)
  const diskChanged = useEditorStore((s) => s.diskChanged)
  const setStCode = useEditorStore((s) => s.setStCode)
  const refresh = useEditorStore((s) => s.refresh)
  const appendLog = useLogsStore((s) => s.append)
  const { send } = useWsConnection()
  const [checking, setChecking] = useState(false)
  const [treeOpen, setTreeOpen] = useState(defaultTreeOpen)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files])
  const lang = currentPath ? langOf(currentPath) : 'st'
  const lineCount = stCode ? stCode.split('\n').length : 0
  // 图签"修订"格:把草稿 ● 和磁盘变更 ⚠ 两个符号合成一个状态读数
  const rev =
    isDirty && diskChanged ? { text: t('code.rev.conflict'), cls: 'alarm', tip: t('code.diskChanged.tooltip') }
    : diskChanged ? { text: t('code.diskChanged'), cls: 'alarm', tip: t('code.diskChanged.tooltip') }
    : isDirty ? { text: t('code.rev.draft'), cls: 'draft', tip: t('code.unsaved') }
    : { text: t('code.rev.saved'), cls: '', tip: '' }

  // 未保存草稿时,关/刷新整页给浏览器原生确认。
  // webview 面板隐藏/销毁不走 beforeunload,只有 visibilitychange 可靠 → 一并挂上:
  // 那里拦不住关闭,能做的是把草稿暂存起来,重建后自动恢复(不落盘,免得静默改用户的文件)。
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => { if (isDirty) { e.preventDefault(); e.returnValue = '' } }
    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return
      try {
        if (isDirty && currentPath) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ path: currentPath, stCode, disk: diskContent }))
        else sessionStorage.removeItem(DRAFT_KEY)
      } catch {}
    }
    window.addEventListener('beforeunload', handler)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      window.removeEventListener('beforeunload', handler)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [isDirty, currentPath, stCode, diskContent])

  // 恢复上面暂存的草稿:仅当当前打开的还是同一文件、且磁盘内容没被改过
  useEffect(() => {
    if (!currentPath || isDirty) return
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const d = JSON.parse(raw)
      sessionStorage.removeItem(DRAFT_KEY)
      if (d?.path === currentPath && d.disk === diskContent && d.stCode !== diskContent) setStCode(d.stCode)
    } catch {}
  }, [currentPath, diskContent])

  // 当前文件被(Agent)打开时,自动展开其所在目录
  useEffect(() => {
    if (!currentPath) return
    const dirs = ancestorDirs(currentPath)
    setCollapsed((prev) => (dirs.some((d) => prev.has(d)) ? new Set([...prev].filter((d) => !dirs.includes(d))) : prev))
  }, [currentPath])

  const onToggleDir = (p: string) =>
    setCollapsed((prev) => { const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next })

  const onSelectFile = async (p: string) => {
    const same = p === currentPath
    if (!same && isDirty && !(await confirmDialog(t('code.confirm.discardSwitch')))) return
    // 插件版顺手在原生 tab 里也开一份:诊断、大纲、F12、折叠全挂在 TextDocument 上,
    // 只在 webview 的 CodeMirror 里打开 = 这些能力对面板用户永远不可达(存盘走 editor:save
    // 直接落磁盘,onDidSaveTextDocument 根本不触发)。web 版没有这个 api,自动跳过。
    // 点的就是当前文件时也要发:用户可能刚把那个原生 tab 关掉,再点一次就是想让它回来,
    // 早退到这行之前会让这次点击彻底没反应。
    vscodeApi()?.postMessage({ type: 'semaplc:open-file', path: p })
    // 反过来 editor:open 可以省:store 里的 currentPath/stCode 一个字都不会变。
    if (same) return
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
      // CONFIGURATION 段先剥掉再送检:rusty --check 只认 POU,原样送过去每个 CONFIGURATION
      // 都变成一串 "expected StartKeyword but found CONFIGURATION"(traffic_light.st 实测 21 条)。
      const r = await fetch((window.__SEMAPLC__?.httpBase ?? '') + '/api/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stCode: stripConfigurationBlock(stCode) }) })
      const j = await r.json()
      // 三态由 server 定(见 routes/check.ts 的 summarizeCheck):stdlib 报错在那边就滤掉了,
      // 判据用的是 server 自己的 checkStdlibDir,前端再猜一遍只会猜错。
      // 未知 outcome(老 server)落到最后一支:摊明细总比假报「通过」强。
      if (j.errorMessage) appendLog({ ts: Date.now(), source: 'tool', level: 'error', message: `✗ plc_check: ${j.errorMessage}` })
      else if (j.outcome === 'passed') appendLog({ ts: Date.now(), source: 'tool', level: 'info', message: '✓ plc_check: rusty check passed' })
      else if (j.outcome === 'truncated') appendLog({ ts: Date.now(), source: 'tool', level: 'info', message: 'ℹ plc_check: no user-code problems found (checker exited early on stdlib; later stages not checked)' })
      else {
        const errors = j.errors ?? []
        appendLog({ ts: Date.now(), source: 'tool', level: 'error', message: `✗ plc_check: ${errors.length} error(s)` })
        for (const e of errors) {
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
            : <Tree node={tree} depth={-1} active={currentPath} collapsed={collapsed} onSelect={onSelectFile} onToggle={onToggleDir} />}
        </div>
      )}
      <div className="code-main">
        <div className="code-filebar">
          {!treeOpen && (
            <button className="tree-expand-btn" onClick={() => setTreeOpen(true)} title={t('code.tree.expand')}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3.5h4l1.2 1.4H14.5v8H1.5z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            </button>
          )}
          <div className="tblk-field grow">
            <span className="tblk-key">{t('code.block.file')}</span>
            <span className="code-fname">{currentPath ?? t('code.filebar.noFile')}</span>
          </div>
          {currentPath && (
            <>
              <div className="tblk-field" title={LANG_LABEL[lang]}>
                <span className="tblk-key">{t('code.block.lines')}</span>
                <span className="tblk-val mono">{lineCount}</span>
              </div>
              <div className="tblk-field">
                <span className="tblk-key">{t('code.block.rev')}</span>
                <span className={'tblk-val ' + rev.cls} title={rev.tip}>{rev.text}</span>
              </div>
            </>
          )}
          <div className="code-meta">
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
