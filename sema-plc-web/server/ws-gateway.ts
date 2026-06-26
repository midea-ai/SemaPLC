import { WebSocketServer, WebSocket } from 'ws'
import { bus, type BusMessage } from './event-bus.js'
import type { ClientMessage, ServerMessage } from '../shared/protocol.js'

export interface WsGatewayOptions {
  port: number
  onConnect?: () => void
  onDisconnect?: () => void
}

// State-bearing message types: cached and replayed to each new client on connect
// so a client that joins after backend hydration still sees the current state.
const STICKY_TYPES = new Set<ServerMessage['type']>([
  'workspace:ready',
  'plc:state',
  'plc:variables',
  'plc:values',
  'editor:files',
  'editor:open',
  'agent:state',
  'agent:todos',
  'scene:ready',
])

export class WsGateway {
  private wss: WebSocketServer
  private clients = new Set<WebSocket>()
  private busOff: () => void
  private opts: WsGatewayOptions
  // Last-seen sticky message per type — replayed to new clients on connect.
  private sticky = new Map<ServerMessage['type'], ServerMessage>()

  constructor(opts: WsGatewayOptions) {
    this.opts = opts
    this.wss = new WebSocketServer({ port: opts.port, host: '127.0.0.1' })
    this.wss.on('connection', (ws) => this.handleConnection(ws))
    this.busOff = bus.on((m) => this.dispatch(m))
  }

  private handleConnection(ws: WebSocket) {
    this.clients.add(ws)
    this.opts.onConnect?.()

    // Replay sticky state to this client only (so late-joiners still see workspace:ready etc.)
    for (const m of this.sticky.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m))
    }

    // 让 bridge 重放当前 turn 快照（sticky 只覆盖 state/todos，不含聊天块）
    bus.emit({ type: 'internal:client-connected' })

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as ClientMessage
        this.relayClientMessage(msg)
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' } satisfies ServerMessage))
      }
    })

    const removeClient = () => {
      if (this.clients.has(ws)) {
        this.clients.delete(ws)
        this.opts.onDisconnect?.()
      }
    }
    ws.on('close', removeClient)
    ws.on('error', removeClient)
  }

  private relayClientMessage(m: ClientMessage) {
    switch (m.type) {
      case 'user:input':
        bus.emit({ type: 'internal:user-input', text: m.text })
        break
      case 'plc:run':
        bus.emit({ type: 'internal:plc-run', stCode: m.stCode })
        break
      case 'plc:stop':
        bus.emit({ type: 'internal:plc-stop' })
        break
      case 'plc:fetch-logs':
        bus.emit({ type: 'internal:plc-fetch-logs', lines: m.lines })
        break
      case 'plc:force':
        bus.emit({ type: 'internal:plc-force', set: m.set, release: m.release })
        break
      case 'agent:interrupt':
        bus.emit({ type: 'internal:agent-interrupt' })
        break
      case 'workspace:switch':
        bus.emit({ type: 'internal:workspace-switch', path: m.path })
        break
      case 'session:reset':
        bus.emit({ type: 'internal:session-reset' })
        break
      case 'editor:save':
        bus.emit({ type: 'internal:editor-save', path: m.path, stCode: m.stCode })
        break
      case 'editor:open':
        bus.emit({ type: 'internal:editor-open', path: m.path })   // P2
        break
      case 'plc:read':
      case 'permission:response':
        // P2 — ignore in P1
        break
      default:
        break
    }
  }

  private dispatch(m: BusMessage) {
    // Only ServerMessage types are broadcast to clients (skip internal:*)
    if ('type' in m && !m.type.startsWith('internal:')) {
      const sm = m as ServerMessage
      // Cache sticky state for late-joining clients.
      if (STICKY_TYPES.has(sm.type)) {
        // workspace:switching invalidates workspace:ready and the snapshot
        if (sm.type === 'workspace:ready') {
          this.sticky.set('workspace:ready', sm)
        } else {
          this.sticky.set(sm.type, sm)
        }
      } else if (sm.type === 'workspace:switching') {
        // Clear sticky snapshot during workspace switch (will repopulate on switch complete)
        this.sticky.clear()
      }
      const payload = JSON.stringify(sm)
      for (const ws of this.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(payload)
      }
    }
  }

  close(): void {
    this.busOff()
    for (const ws of this.clients) ws.close()
    this.clients.clear()
    this.wss.close()
  }

  getClientCount(): number { return this.clients.size }
}
