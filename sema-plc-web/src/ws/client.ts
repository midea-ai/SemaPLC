import type { ClientMessage, ServerMessage } from '../../shared/protocol'

type Listener = (m: ServerMessage) => void

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error'

export class WsClient {
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
let _instance: WsClient | null = null
export function initWsClient(url: string): WsClient {
  if (!_instance) {
    _instance = new WsClient(url)
    _instance.connect()
  }
  return _instance
}
export function getWsClient(): WsClient {
  if (!_instance) throw new Error('WsClient not initialized')
  return _instance
}
