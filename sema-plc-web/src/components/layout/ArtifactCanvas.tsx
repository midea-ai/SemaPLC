import { useState } from 'react'
import { useT } from '../../i18n'
import { CodeView } from '../center/CodeView'
import { LadderCanvas } from '../center/LadderCanvas'
// FuxaPanel 已废弃隐藏(2026-06-05):过程仿真只保留原生 SimRuntime。
// import { FuxaPanel } from '../center/FuxaPanel'
import { VariableMonitor } from '../right/VariableMonitor'
import { BottomLogs } from './BottomLogs'
import { useEditorStore } from '../../store/editor'
import { usePlcStore } from '../../store/plc'
import { SimRuntime } from '../sim/SimRuntime'
import { ErrorBoundary } from '../ErrorBoundary'

type TabId = 'process' | 'code' | 'logic' | 'vars' | 'logs'

const IC = {
  process: <svg width="15" height="15" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" /></svg>,
  code: <svg width="15" height="15" viewBox="0 0 16 16"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  logic: <svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  vars: <svg width="15" height="15" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M2 6.5h12M6.5 6.5V13" stroke="currentColor" strokeWidth="1.1" /></svg>,
  logs: <svg width="15" height="15" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
}

export function ArtifactCanvas() {
  const [tab, setTab] = useState<TabId>('code')
  const stCode = useEditorStore((s) => s.stCode)
  const varCount = usePlcStore((s) => s.variableMap.length)
  const t = useT()

  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'process', label: t('canvas.tab.process') },
    { id: 'code', label: t('canvas.tab.code') },
    { id: 'logic', label: t('canvas.tab.logic') },
    { id: 'vars', label: t('canvas.tab.vars'), badge: varCount || undefined },
    { id: 'logs', label: t('canvas.tab.logs') },
  ]

  return (
    <section className="artifact-canvas">
      <div className="tab-bar">
        {tabs.map((tabDef) => (
          <button key={tabDef.id} className={'tab' + (tab === tabDef.id ? ' active' : '')} onClick={() => setTab(tabDef.id)}>
            <span className="tab-ic">{IC[tabDef.id]}</span>
            {tabDef.label}
            {tabDef.badge != null && <span className="tab-badge">{tabDef.badge}</span>}
          </button>
        ))}
      </div>
      <div className="canvas-body">
        {/* Keep panels mounted across tab switches so live state (ladder coloring,
            variable polling) isn't torn down; just toggle visibility. */}
        <Pane show={tab === 'process'}>
          {/* FUXA 过程仿真(高级·手动)已于 2026-06-05 隐藏废弃,只保留原生 SimRuntime。
              FUXA 相关代码(FuxaPanel / server/routes/fuxa / plc-tools fuxaProject·fuxaWidgets)
              标 @deprecated 保留;如需恢复:还原本段的 sim-mode-bar + FuxaPanel 切换。 */}
          <div className="sim-host">
            {/* 仿真页独立边界:坏 scene 把 SimRuntime 渲崩时,只在本页显示兜底,
                同时挂载的代码/梯图/变量/日志页不受牵连(它们始终 mounted)。 */}
            <ErrorBoundary label={t('canvas.sim.errorBoundary')}>
              <SimRuntime />
            </ErrorBoundary>
          </div>
        </Pane>
        <Pane show={tab === 'code'}><CodeView /></Pane>
        <Pane show={tab === 'logic'}><LadderCanvas stCode={stCode} /></Pane>
        <Pane show={tab === 'vars'}><VariableMonitor /></Pane>
        <Pane show={tab === 'logs'}><BottomLogs /></Pane>
      </div>
    </section>
  )
}

function Pane({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <div style={{ display: show ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>{children}</div>
}
