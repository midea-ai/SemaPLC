import { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useT } from '../../i18n'
import { CodeView } from '../center/CodeView'
import { LadderCanvas } from '../center/LadderCanvas'
import { VariableMonitor } from '../right/VariableMonitor'
import { BottomLogs } from './BottomLogs'
import { useEditorStore } from '../../store/editor'
import { usePlcStore } from '../../store/plc'
import { SimRuntime } from '../sim/SimRuntime'
import { ErrorBoundary } from '../ErrorBoundary'
import type { LayoutMode } from '../../App'

type MainTab = 'code' | 'logic'
type BottomTab = 'process' | 'vars' | 'logs'

const IC = {
  code: <svg width="15" height="15" viewBox="0 0 16 16"><path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  logic: <svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
  process: <svg width="15" height="15" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M6.5 5.5l4 2.5-4 2.5z" fill="currentColor" /></svg>,
  vars: <svg width="15" height="15" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" /><path d="M2 6.5h12M6.5 6.5V13" stroke="currentColor" strokeWidth="1.1" /></svg>,
  logs: <svg width="15" height="15" viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>,
}

export function ArtifactCanvas({ layout }: { layout: LayoutMode }) {
  const [mainTab, setMainTab] = useState<MainTab>('code')
  const [bottomTab, setBottomTab] = useState<BottomTab>('process')
  const stCode = useEditorStore((s) => s.stCode)
  const varCount = usePlcStore((s) => s.variableMap.length)
  const t = useT()

  const mainTabs: { id: MainTab; label: string }[] = [
    { id: 'code', label: t('canvas.tab.code') },
    { id: 'logic', label: t('canvas.tab.logic') },
  ]
  const bottomTabs: { id: BottomTab; label: string; badge?: number }[] = [
    { id: 'process', label: t('canvas.tab.process') },
    { id: 'vars', label: t('canvas.tab.vars'), badge: varCount || undefined },
    { id: 'logs', label: t('canvas.tab.logs') },
  ]

  const mainPane = (
    <div className="split-pane">
      <div className="tab-bar">
        {mainTabs.map((td) => (
          <button key={td.id} className={'tab' + (mainTab === td.id ? ' active' : '')} onClick={() => setMainTab(td.id)}>
            <span className="tab-ic">{IC[td.id]}</span>
            {td.label}
          </button>
        ))}
      </div>
      <div className="canvas-body">
        <Pane show={mainTab === 'code'}><CodeView /></Pane>
        <Pane show={mainTab === 'logic'}><LadderCanvas stCode={stCode} /></Pane>
      </div>
    </div>
  )

  const bottomPane = (
    <div className="split-pane">
      <div className="tab-bar">
        {bottomTabs.map((td) => (
          <button key={td.id} className={'tab' + (bottomTab === td.id ? ' active' : '')} onClick={() => setBottomTab(td.id)}>
            <span className="tab-ic">{IC[td.id]}</span>
            {td.label}
            {td.badge != null && <span className="tab-badge">{td.badge}</span>}
          </button>
        ))}
      </div>
      <div className="canvas-body">
        <Pane show={bottomTab === 'process'}>
          <div className="sim-host">
            <ErrorBoundary label={t('canvas.sim.errorBoundary')}>
              <SimRuntime />
            </ErrorBoundary>
          </div>
        </Pane>
        <Pane show={bottomTab === 'vars'}><VariableMonitor /></Pane>
        <Pane show={bottomTab === 'logs'}><BottomLogs /></Pane>
      </div>
    </div>
  )

  // ponytail: split = 上下分栏, columns = 左右三栏
  const dir = layout === 'columns' ? 'horizontal' : 'vertical'
  const handleClass = layout === 'columns' ? 'resize-handle-v' : 'resize-handle-h'
  const saveId = layout === 'columns' ? 'artifact-cols' : 'artifact-split'

  return (
    <section className="artifact-canvas">
      <PanelGroup direction={dir} autoSaveId={saveId} key={layout}>
        <Panel defaultSize={55} minSize={20}>
          {mainPane}
        </Panel>
        <PanelResizeHandle className={handleClass} />
        <Panel defaultSize={45} minSize={15}>
          {bottomPane}
        </Panel>
      </PanelGroup>
    </section>
  )
}

function Pane({ show, children }: { show: boolean; children: React.ReactNode }) {
  return <div style={{ display: show ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>{children}</div>
}
