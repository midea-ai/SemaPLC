import type { ClientMessage, ServerMessage } from '../../shared/protocol'
import type { Listener, WsClientLike, WsStatus } from './client'
// vscodeApi 的模块级单例住在 confirmDialog.ts —— acquireVsCodeApi() 全局只能调一次,
// 那边的注释已写明「往扩展发消息的不止确认框」,这里就是它预期的第二个调用方。
import { vscodeApi } from '../lib/confirmDialog'

/**
 * VSCode 侧的传输层:webview 不自己连 WS,收发都经扩展宿主转发(hub 模式,见方案 §4.1)。
 *
 * 信封两条方向各两种,与 sema-plc-vscode/src/bus.ts 一一对应,改一边必须改另一边:
 *   webview → 扩展   view:ready(握手) / ws:send(ClientMessage 原样回灌)
 *   扩展 → webview   ws:message(ServerMessage) / ws:status(连接态)
 *
 * ready 握手不是可选的:webview 隐藏即销毁、可见时页面从头加载,而 VSCode **不在 API 层
 * 缓冲 postMessage**。扩展若在 onDidChangeViewState 那一刻就推,webview 的 JS 还没注册
 * 监听,消息直接丢 —— 表现为切回侧边栏一片空白。所以全量推送一律由本类发出的 ready 触发。
 */
export class VscodeWsClient implements WsClientLike {
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(s: WsStatus) => void>()
  // 初值 connecting 而不是 closed:hub 的第一条 ws:status 到达前,界面该显示"连接中"
  // 而不是"已断开"——后者会让用户以为出了错并去点重连。
  private status: WsStatus = 'connecting'

  constructor(private readonly view: string) {
    window.addEventListener('message', this.onHostMessage)
    vscodeApi()?.postMessage({ type: 'view:ready', view })
  }

  private onHostMessage = (e: MessageEvent): void => {
    const d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'ws:message') {
      const m = d.payload as ServerMessage
      // 逐个 try:一个 store 的 handler 抛异常不该让同一条消息的其余订阅者收不到。
      this.listeners.forEach((cb) => {
        try {
          cb(m)
        } catch {
          /* 单个订阅者出错不牵连其他 */
        }
      })
      return
    }
    if (d.type === 'ws:status') this.setStatus(d.status as WsStatus)
  }

  getStatus(): WsStatus {
    return this.status
  }

  send(m: ClientMessage): void {
    // 不做 open 检查:WS 的真实状态在扩展那侧,这里判断只会依据一份可能过期的副本
    // 丢掉消息。hub 在 WS 未就绪时丢弃,与 WsClient.send 的行为一致。
    vscodeApi()?.postMessage({ type: 'ws:send', payload: m })
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onStatus(cb: (s: WsStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  private setStatus(s: WsStatus): void {
    this.status = s
    this.statusListeners.forEach((cb) => cb(s))
  }
}
