import React from 'react'
import ReactDOM from 'react-dom/client'
import '../index.css'
import '../styles/semaplc.css'
import '../styles/vscode-theme.css'
import { setWsClient } from '../ws/client'
import { VscodeWsClient } from '../ws/vscodeClient'
import { wireStores } from '../store'
import { ChatPanel } from '../components/left/ChatPanel'
import { ErrorBoundary } from '../components/ErrorBoundary'

// 主题直接钉死,不经 theme.ts —— 那个模块在加载期就从 localStorage 写 data-theme,
// 而侧边栏没有主题切换入口(跟随 VSCode)。这里不 import 它,冲突自然不存在。
document.documentElement.dataset.theme = 'vscode'

// 侧边栏不自己连 WS:扩展宿主是唯一 WS 客户端,收发都经 postMessage 转发(方案 §4.1)。
// 只 new 一次 —— VscodeWsClient 的构造函数会挂 message 监听并发 ready 握手,
// 多造一个即使不被 setWsClient 采用,监听也已经挂上了(消息处理两遍 + 泄漏)。
const client = setWsClient(new VscodeWsClient('chat'))
// 只订这两个 —— ChatPanel 读的就是 agent(消息/状态/todos/usage)与 model(thinking)。
wireStores(client, ['agent', 'model'])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="对话">
      <ChatPanel />
    </ErrorBoundary>
  </React.StrictMode>,
)
