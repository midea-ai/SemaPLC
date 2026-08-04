import * as vscode from 'vscode'
import WebSocket from 'ws'
import { STICKY_TYPES, type ClientMessage, type ServerMessage } from '../../sema-plc-web/shared/protocol'

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

/**
 * 容器引擎状态。'unknown' = 还没探测,此时**不渲染**任何提示 —— 首开那两秒闪一条
 * "运行时不可用" 再收回去,比不提示更糟。
 */
export type EngineStatus = 'unknown' | 'ready' | 'none'

/**
 * 扩展是唯一的 WS 客户端(方案 §4.1):server ──ws──> 扩展 ──postMessage──> 各 webview。
 *
 * 为什么不让 webview 自己连:扩展侧本来就必须消费 plc:* 来驱动状态栏和变量树(第 3 步),
 * 各连各的就是 4 条连接而不是 3 条;而且单点重连意味着 server 换端口时不会有 webview
 * 僵死在旧端口上,CSP 也能收到 default-src 'none'。
 *
 * WsClient(web 侧那份)不能跨包复用:它的 send() 读全局 WebSocket.OPEN 而非注入的 ctor,
 * 而扩展是 lib:["ES2022"] 无 DOM、@types/node 也不声明 WebSocket ⇒ tsc 必挂。web 侧现有的
 * ws-client 测试跑在 jsdom 里(有全局 WebSocket),永远测不出这个差异。所以这里用 npm ws。
 */
export class Bus {
  private ws: WebSocket | undefined
  private url: string | undefined
  private status: WsStatus = 'closed'
  private engine: EngineStatus = 'unknown'
  /** 状态条上「重试」的回调(重新探测 + 重启 server)。由 extension.ts 装上。 */
  private onEngineRetry: (() => void) | undefined
  /** 每个 view 一份 webview 句柄 + 它的消息订阅;ready 之前不推任何东西。 */
  private views = new Map<string, { webview: vscode.Webview; ready: boolean; sub: vscode.Disposable }>()
  private sticky = new Map<ServerMessage['type'], ServerMessage>()
  private extListeners = new Set<(m: ServerMessage) => void>()
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private backoffMs = 1000
  private disposed = false

  constructor(private readonly out: vscode.OutputChannel) {}

  /**
   * 连到(或改连到)给定端口。端口没变且连接还活着就什么都不做 —— server 崩溃重启会
   * 沿用原端口,那种情况下重连由 onclose 自己驱动,这里不该把好端端的连接掐掉重来。
   */
  connect(wsPort: number): void {
    const url = `ws://127.0.0.1:${wsPort}`
    if (this.url === url && this.ws && this.ws.readyState <= WebSocket.OPEN) return
    this.url = url
    // 换端口 = 换了一个 server 进程,旧进程的状态快照全部作废。不清的话新 webview
    // 会先收到一份上个工作区的 editor:files / workspace:ready。
    this.sticky.clear()
    this.open()
  }

  private open(): void {
    if (this.disposed || !this.url) return
    this.closeSocket()
    this.setStatus('connecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.on('open', () => {
      if (this.ws !== ws) return
      this.backoffMs = 1000
      this.setStatus('open')
    })
    ws.on('message', (data: WebSocket.RawData) => {
      if (this.ws !== ws) return
      let m: ServerMessage
      try {
        m = JSON.parse(data.toString())
      } catch {
        return // 畸形帧直接丢,和 web 侧 WsClient 一致
      }
      if (STICKY_TYPES.has(m.type)) this.sticky.set(m.type, m)
      // 暂不按 view 过滤:眼下只有 chat 一个 webview,过滤表是一张需要跟着协议改的空账。
      // 第 4 步加了 ladder/sim 之后再按 view 分流(那时 agent 的 token 流确实不该发给它们)。
      this.broadcast({ type: 'ws:message', payload: m })
    })
    ws.on('error', (e: Error) => {
      if (this.ws !== ws) return
      this.out.appendLine(`[bus] ${e.message}`)
      this.setStatus('error')
    })
    ws.on('close', () => {
      // 迟到的 close:this.ws 已经指向新连接(换端口时)。少了这道守卫,旧连接的
      // close 会把刚建好的连接标成断开,并再排一次重连。
      if (this.ws !== ws) return
      this.ws = undefined
      this.setStatus('closed')
      this.scheduleReconnect()
    })
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, 10_000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.open()
    }, delay)
  }

  /**
   * 注册一个 webview。返回的 Disposable 用于视图销毁时摘掉它。
   *
   * 同名 view 重复 attach 会先摘掉上一份订阅 —— resolveWebviewView 是会被反复调用的
   * (每次 semaplc.open、视图重建都来一次),而 onDidReceiveMessage 是多播:旧的不摘,
   * 用户敲一句话就被转发 N 次,agent 那边真的会跑 N 轮。
   *
   * 幂等做在这里而不是让调用方记得先 dispose:调用方只要漏一次就是这个 bug,
   * 而这里守一次,所有入口都不会踩。
   */
  attach(view: string, webview: vscode.Webview): vscode.Disposable {
    this.views.get(view)?.sub.dispose()
    const sub = webview.onDidReceiveMessage((msg: unknown) => this.onViewMessage(view, msg))
    this.views.set(view, { webview, ready: false, sub })
    return new vscode.Disposable(() => {
      // 只摘自己:重复 attach 之后旧的 Disposable 可能晚到,那时 views 里存的已经是
      // 新一份订阅,不能让它把还在用的连带删掉。
      if (this.views.get(view)?.sub !== sub) return
      sub.dispose()
      this.views.delete(view)
    })
  }

  private onViewMessage(view: string, msg: unknown): void {
    const m = msg as { type?: string; payload?: unknown }
    if (!m || typeof m.type !== 'string') return
    if (m.type === 'view:ready') {
      const entry = this.views.get(view)
      if (!entry) return
      entry.ready = true
      // 重放必须由 ready 触发,不能由 onDidChangeViewState 触发:webview 隐藏即销毁、
      // 可见时页面从头加载,而 VSCode 不在 API 层缓冲 postMessage —— 在事件那一刻推,
      // webview 的 JS 还没注册监听,消息直接丢,表现为切回来一片空白。
      void entry.webview.postMessage({ type: 'ws:status', status: this.status })
      void entry.webview.postMessage({ type: 'engine:status', status: this.engine })
      for (const sm of this.sticky.values()) void entry.webview.postMessage({ type: 'ws:message', payload: sm })
      return
    }
    if (m.type === 'ws:send') this.send(m.payload as ClientMessage)
    if (m.type === 'engine:retry') this.onEngineRetry?.()
    // 状态条的「去配置」。侧边栏没有 web 版顶栏的 ModelPanel,这是填 key 的唯一入口。
    if (m.type === 'model:configure') void vscode.commands.executeCommand('semaplc.setApiKey')
  }

  /** 探测结果 → 状态条。与 setStatus 同构:只推给已 ready 的 view,新 view 靠 ready 重放。 */
  setEngine(s: EngineStatus): void {
    if (this.engine === s) return
    this.engine = s
    for (const { webview, ready } of this.views.values()) {
      if (ready) void webview.postMessage({ type: 'engine:status', status: s })
    }
  }

  onRetryEngine(cb: () => void): void {
    this.onEngineRetry = cb
  }

  /** webview → server。WS 没就绪时丢弃,与 web 侧 WsClient.send 的行为一致。 */
  send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m))
  }

  /** 扩展自己订阅 server 消息(状态栏、变量树在第 3 步会用)。 */
  onMessage(cb: (m: ServerMessage) => void): vscode.Disposable {
    this.extListeners.add(cb)
    return new vscode.Disposable(() => this.extListeners.delete(cb))
  }

  private broadcast(envelope: { type: string; payload: ServerMessage }): void {
    for (const { webview, ready } of this.views.values()) {
      if (ready) void webview.postMessage(envelope)
    }
    this.extListeners.forEach((cb) => {
      try {
        cb(envelope.payload)
      } catch (e) {
        this.out.appendLine(`[bus] listener: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  }

  private setStatus(s: WsStatus): void {
    if (this.status === s) return
    this.status = s
    for (const { webview, ready } of this.views.values()) {
      if (ready) void webview.postMessage({ type: 'ws:status', status: s })
    }
  }

  private closeSocket(): void {
    const ws = this.ws
    this.ws = undefined
    if (!ws) return
    // 先摘再关:上面 close 回调里的 `this.ws !== ws` 守卫据此判断自己已过期,不会排重连。
    ws.removeAllListeners()
    try {
      ws.close()
    } catch {
      /* 已经关了 */
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.closeSocket()
    this.views.clear()
    this.extListeners.clear()
  }
}
