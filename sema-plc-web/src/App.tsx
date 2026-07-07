import { useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import './styles/semaplc.css'
import { initWsClient } from './ws/client'
import { wireStoresToWs } from './store'
import { TopBar } from './components/layout/TopBar'
import { ChatPanel } from './components/left/ChatPanel'
import { ArtifactCanvas } from './components/layout/ArtifactCanvas'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useT } from './i18n'

initWsClient(`ws://${window.location.hostname}:3002`)
wireStoresToWs()

export type LayoutMode = 'split' | 'columns'

const readLayout = (): LayoutMode => {
  try { const v = localStorage.getItem('semaplc:layout'); if (v === 'columns') return 'columns' } catch {}
  return 'split'
}

export default function App() {
  const t = useT()
  const [chatOpen, setChatOpen] = useState(true)
  const [layout, setLayout] = useState<LayoutMode>(readLayout)
  const toggleLayout = () => {
    const next: LayoutMode = layout === 'split' ? 'columns' : 'split'
    setLayout(next)
    localStorage.setItem('semaplc:layout', next)
  }

  return (
    <div className="app-root">
      <TopBar layout={layout} onToggleLayout={toggleLayout} />
      <ErrorBoundary label={t('common.errorBoundary.uiLabel')}>
        <div className="main-split">
          {chatOpen ? (
            <PanelGroup direction="horizontal" autoSaveId="main-split">
              <Panel defaultSize={35} minSize={20} maxSize={50}>
                <ChatPanel onCollapse={() => setChatOpen(false)} />
              </Panel>
              <PanelResizeHandle className="resize-handle-v" />
              <Panel minSize={40}>
                <ArtifactCanvas layout={layout} />
              </Panel>
            </PanelGroup>
          ) : (
            <>
              <button className="chat-expand" onClick={() => setChatOpen(true)} title={t('chat.expand')}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" transform="rotate(-90 8 8)" />
                </svg>
              </button>
              <ArtifactCanvas layout={layout} />
            </>
          )}
        </div>
      </ErrorBoundary>
    </div>
  )
}
