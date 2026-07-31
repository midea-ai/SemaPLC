import type { ClientMessage, ServerMessage } from '../../shared/protocol'

export type Listener = (m: ServerMessage) => void

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

/**
 * store 与 hook 只依赖这四个方法。抽成接口是为了让 VSCode 侧的 postMessage 传输层
 * (ws/vscodeClient.ts)能顶替进来 —— WsClient 带 private 字段,TS 下只有它自己的实例
 * 满足其类型,直接 `import type { WsClient }` 会把别的实现全挡在门外。
 */
export interface WsClientLike {
  getStatus(): WsStatus
  send(m: ClientMessage): void
  on(cb: Listener): () => void
  onStatus(cb: (s: WsStatus) => void): () => void
}

export class WsClient implements WsClientLike {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(s: WsStatus) => void>()
  private url: string
  private backoffMs = 1000
  private maxBackoff = 10000
  private currentStatus: WsStatus = 'connecting'

  constructor(url: string) {
    this.url = url
  }

  getStatus(): WsStatus { return this.currentStatus }

  connect(): void {
    this.setStatus('connecting')
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => {
      this.backoffMs = 1000
      this.setStatus('open')
    }
    this.ws.onmessage = (ev) => {
      try {
        const m: ServerMessage = JSON.parse(ev.data)
        this.listeners.forEach(cb => cb(m))
      } catch {
        // ignore malformed
      }
    }
    this.ws.onerror = () => this.setStatus('error')
    this.ws.onclose = () => {
      this.setStatus('closed')
      setTimeout(() => this.connect(), this.backoffMs)
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoff)
    }
  }

  send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m))
    }
  }

  on(cb: Listener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onStatus(cb: (s: WsStatus) => void): () => void {
    this.statusListeners.add(cb)
    return () => this.statusListeners.delete(cb)
  }

  private setStatus(s: WsStatus) {
    this.currentStatus = s
    this.statusListeners.forEach(cb => cb(s))
  }
}

// Singleton (constructed in main.tsx)
let _instance: WsClientLike | null = null
export function initWsClient(url: string): WsClientLike {
  if (!_instance) {
    const c = new WsClient(url)
    c.connect()
    _instance = c
  }
  return _instance
}

/**
 * 注入别的传输实现(VSCode 入口用 postMessage 桥,见 ws/vscodeClient.ts)。
 * 与 initWsClient 一样是先到先得:两者都只在入口模块顶部调一次。
 */
export function setWsClient(client: WsClientLike): WsClientLike {
  if (!_instance) _instance = client
  return _instance
}

export function getWsClient(): WsClientLike {
  if (!_instance) throw new Error('WsClient not initialized')
  return _instance
}
