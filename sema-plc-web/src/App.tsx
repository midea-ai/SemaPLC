import './styles/semaplc.css'
import { initWsClient } from './ws/client'
import { wireStoresToWs } from './store'
import { TopBar } from './components/layout/TopBar'
import { ChatPanel } from './components/left/ChatPanel'
import { ArtifactCanvas } from './components/layout/ArtifactCanvas'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useT } from './i18n'

// Initialise WS client + wire stores eagerly at module load. Doing this in a
// useEffect can race with WS connect — by the time React commits, the WS may
// already have received (and dropped) the initial sticky-replay messages.
initWsClient(`ws://${window.location.hostname}:3002`)
wireStoresToWs()

export default function App() {
  const t = useT()
  return (
    <div className="app-root">
      <TopBar />
      {/* 顶层总兜底:任一面板(非仅仿真)在 render/生命周期抛错时,不再整页白屏。 */}
      <ErrorBoundary label={t('common.errorBoundary.uiLabel')}>
        <div className="main-split">
          <ChatPanel />
          <ArtifactCanvas />
        </div>
      </ErrorBoundary>
    </div>
  )
}
