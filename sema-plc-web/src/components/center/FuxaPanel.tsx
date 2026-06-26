// @deprecated (2026-06-05): FUXA 过程仿真已从 web 隐藏废弃,改用原生 SimRuntime(src/components/sim)。
// 代码保留备查;前端不再渲染 FuxaPanel、不再调用 /api/fuxa。如需恢复见 ArtifactCanvas 过程仿真 Pane 注释。
import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editor'
import './fuxa-panel.css'

type Widget = { name: string; address: string; dir: string }

export function FuxaPanel() {
  const stCode = useEditorStore((s) => s.stCode)
  const currentPath = useEditorStore((s) => s.currentPath)
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [fuxaUrl, setFuxaUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [viewUrl, setViewUrl] = useState<string | null>(null)
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/fuxa/status').then((r) => r.json()).then((j) => { setReachable(!!j.reachable); setFuxaUrl(j.fuxaUrl || '') }).catch(() => setReachable(false))
  }, [])

  const isSt = !!currentPath && currentPath.toLowerCase().endsWith('.st')

  const deploy = async () => {
    if (busy || !stCode.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/fuxa/deploy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stCode }) })
      const j = await r.json()
      if (!j.ok) { setError(j.error || '部署失败'); setViewUrl(null) }
      else { setViewUrl(j.viewUrl); setWidgets(j.widgets || []); setError(null) }
    } catch (e) {
      setError(String(e))
    } finally { setBusy(false) }
  }

  // Deployed → embed the FUXA view.
  if (viewUrl) {
    return (
      <div className="fuxa-wrap">
        <div className="fuxa-bar">
          <span className="fuxa-live">● 过程仿真已部署</span>
          <span className="fuxa-widgets">{widgets.length} 个部件:{widgets.map((w) => w.name).join(' · ')}</span>
          <span className="fuxa-spacer" />
          <button className="fuxa-btn" onClick={deploy} disabled={busy}>{busy ? '更新中…' : '↻ 重新生成'}</button>
          <a className="fuxa-btn" href={viewUrl} target="_blank" rel="noreferrer">↗ 新窗口</a>
        </div>
        <iframe className="fuxa-frame" src={viewUrl} title="FUXA 过程仿真" />
      </div>
    )
  }

  // Not deployed → placeholder + action.
  return (
    <div className="artifact-empty">
      <div className="ae-illu">
        <svg width="54" height="40" viewBox="0 0 54 40" aria-hidden="true">
          <rect x="2" y="22" width="50" height="9" rx="4.5" fill="none" stroke="var(--text-3)" strokeWidth="1.4" />
          <circle cx="9" cy="26.5" r="3" fill="none" stroke="var(--text-3)" strokeWidth="1.2" />
          <circle cx="45" cy="26.5" r="3" fill="none" stroke="var(--text-3)" strokeWidth="1.2" />
          <rect x="22" y="10" width="10" height="10" rx="1.5" fill="none" stroke="var(--brand)" strokeWidth="1.4" />
        </svg>
      </div>
      <p className="ae-text">过程仿真(FUXA)</p>
      <p className="ae-sub">Agent 按代码语义自动选配 FUXA 部件并绑定 IO,生成可运行的过程画面并嵌入此处。需当前程序为 <code>.st</code> 且 FUXA 已启动。</p>
      {reachable === false && (
        <p className="fuxa-warn">FUXA 不可达({fuxaUrl || 'FUXA_URL'})。请先启动 FUXA 容器(详见 README)。</p>
      )}
      {error && <p className="fuxa-err">{error}</p>}
      <button className="fuxa-cta" onClick={deploy} disabled={busy || !isSt || reachable === false}>
        {busy ? '生成中…' : '生成过程仿真'}
      </button>
      {!isSt && <p className="ae-sub">(在「代码」tab 选择一个 .st 程序)</p>}
    </div>
  )
}
