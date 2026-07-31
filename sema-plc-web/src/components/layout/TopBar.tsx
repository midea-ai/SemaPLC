import { useState } from 'react'
import { useWorkspaceStore } from '../../store/workspace'
import { usePlcStore } from '../../store/plc'
import { useEditorStore } from '../../store/editor'
import { useWsConnection } from '../../ws/useWsConnection'
import { useT, useLang, setLang } from '../../i18n'
import { ModelPanel } from './ModelPanel'
import { readTheme, applyTheme, type Theme } from '../../theme'
import type { LayoutMode } from '../../App'

type Tone = 'ok' | 'idle' | 'warn' | 'err'
const TONE: Record<Tone, string> = { ok: 'var(--ok)', idle: 'var(--text-3)', warn: 'var(--warn)', err: 'var(--err)' }

function StatusDot({ tone, label, pulse }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <span className="status-dot-wrap">
      <span className={'status-dot' + (pulse ? ' pulse' : '')} style={{ background: TONE[tone] }} />
      <span className="status-dot-label">{label}</span>
    </span>
  )
}

export function TopBar({ layout, onToggleLayout }: { layout: LayoutMode; onToggleLayout: () => void }) {
  const t = useT()
  const lang = useLang()
  const workspace = useWorkspaceStore((s) => s.path)
  const switching = useWorkspaceStore((s) => s.switching)
  const status = usePlcStore((s) => s.status)
  const stProgram = useEditorStore((s) => s.stProgram)
  const stProgramPath = useEditorStore((s) => s.stProgramPath)
  const isDirty = useEditorStore((s) => s.isDirty)
  const currentPath = useEditorStore((s) => s.currentPath)
  const { send, status: wsStatus } = useWsConnection()
  const [editing, setEditing] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [theme, setTheme] = useState<Theme>(readTheme)

  const toggleTheme = () => {
    const next: Theme = theme === 'sheet' ? 'modern' : 'sheet'
    setTheme(next)
    applyTheme(next)
  }

  const submitSwitch = () => {
    if (pathInput.trim()) send({ type: 'workspace:switch', path: pathInput.trim() })
    setEditing(false)
  }

  const running = status === 'RUNNING'
  const run: [Tone, string, boolean] = running ? ['ok', t('topbar.status.running'), true] : ['idle', t('topbar.status.stopped'), false]
  const conn: [Tone, string, boolean] =
    wsStatus === 'open' ? ['ok', t('topbar.status.connected'), false]
    : wsStatus === 'connecting' ? ['warn', t('topbar.status.connecting'), true]
    : ['idle', t('topbar.status.disconnected'), false]
  const comp: [Tone, string, boolean] =
    status === 'ERROR' ? ['err', t('topbar.status.compileError'), false]
    : status === 'EMPTY' ? ['idle', t('topbar.status.notCompiled'), false]
    : ['ok', t('topbar.status.compiled'), false]

  return (
    <header className="topbar">
      <div className="tb-left">
        <span className="logo-hex">
          <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true">
            <path d="M10 1 18.66 6 18.66 16 10 21 1.34 16 1.34 6Z" fill="none" stroke="var(--brand)" strokeWidth="1.6" />
            <circle cx="10" cy="11" r="3.1" fill="var(--brand)" />
          </svg>
        </span>
        <span className="tb-title">SemaPLC</span>
        {editing ? (
          <input
            autoFocus
            className="tb-path-input"
            value={pathInput}
            placeholder={workspace ?? ''}
            onChange={(e) => setPathInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitSwitch()}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span
            className="tb-path"
            title={t('topbar.path.tooltip')}
            onDoubleClick={() => { setPathInput(workspace ?? ''); setEditing(true) }}
          >{switching ? t('topbar.path.switching') : (workspace ?? '—')}</span>
        )}
      </div>

      <div className="tb-right">
        <ModelPanel />
        <button type="button" className="layout-toggle" onClick={onToggleLayout} title={t(layout === 'split' ? 'topbar.layout.columns' : 'topbar.layout.split')}>
          {layout === 'split' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="2" width="4.5" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="6.5" y="2" width="4" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="11.5" y="2" width="3.5" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1" y="2" width="6" height="12" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="2" width="7" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/><rect x="8" y="9" width="7" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          )}
        </button>
        <button type="button" className="layout-toggle" onClick={toggleTheme}
          title={t(theme === 'sheet' ? 'topbar.theme.toModern' : 'topbar.theme.toSheet')}>
          {theme === 'sheet' ? (
            /* 图纸态:显示"换成圆角卡片"的去处 */
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2"/><circle cx="5" cy="8" r="1.6" fill="currentColor"/></svg>
          ) : (
            /* modern 态:显示"换成网格图纸"的去处 */
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M6 2.5v11M10.5 2.5v11M1.5 6.5h13M1.5 10h13" stroke="currentColor" strokeWidth=".8" opacity=".6"/></svg>
          )}
        </button>
        <div className="lang-toggle" role="group" aria-label="Language">
          <button type="button" className={lang === 'zh' ? 'active' : ''} aria-pressed={lang === 'zh'} onClick={() => setLang('zh')}>中</button>
          <button type="button" className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
        <div className="status-pill">
          <StatusDot tone={run[0]} label={run[1]} pulse={run[2]} />
          <span className="pill-sep" />
          <StatusDot tone={conn[0]} label={conn[1]} pulse={conn[2]} />
          <span className="pill-sep" />
          <StatusDot tone={comp[0]} label={comp[1]} pulse={comp[2]} />
        </div>
        <div className="tb-actions">
          <button
            className="tb-btn reset"
            disabled={switching || wsStatus !== 'open'}
            onClick={() => {
              if (window.confirm(t('topbar.reset.confirm'))) {
                send({ type: 'session:reset' })
              }
            }}
            title={t('topbar.reset.tooltip')}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M6 1a5 5 0 1 0 5 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6 0v2.5l2-1.25z" fill="currentColor"/>
            </svg>
            {t('topbar.reset')}
          </button>
          <button
            className="tb-btn run"
            disabled={!stProgram.trim() || wsStatus !== 'open'}
            onClick={() => send({ type: 'plc:run', stCode: stProgram })}
            title={
              running
                ? t('topbar.run.rerunTooltip')
                : stProgramPath
                  ? t('topbar.runFile', { path: stProgramPath }) + (currentPath === stProgramPath && isDirty ? ' — ' + t('topbar.run.unsavedHint') : '')
                  : t('topbar.run.noFileTooltip')
            }
          >
            <svg width="11" height="12" viewBox="0 0 11 12" aria-hidden="true"><path d="M1 1l9 5-9 5z" fill="currentColor" /></svg>
            {running ? t('topbar.rerun') : t('topbar.run')}
          </button>
          <button
            className="tb-btn stop"
            disabled={!running || wsStatus !== 'open'}
            onClick={() => send({ type: 'plc:stop' })}
            title={t('topbar.stop.tooltip')}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect width="10" height="10" rx="1.5" fill="currentColor" /></svg>
            {t('topbar.stop')}
          </button>
        </div>
      </div>
    </header>
  )
}
