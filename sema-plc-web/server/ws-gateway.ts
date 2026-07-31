import { WebSocketServer, WebSocket } from 'ws'
import { bus, type BusMessage } from './event-bus.js'
import { STICKY_TYPES, type ClientMessage, type ServerMessage } from '../shared/protocol.js'

export interface WsGatewayOptions {
  port: number
  onConnect?: () => void
  onDisconnect?: () => void
}

// STICKY_TYPES 已挪到 shared/protocol.ts —— VSCode 扩展的 bus.ts 也要用同一份,
// 而它不能 import 本文件(会把整个 server 依赖树打进 extension.js)。

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
      case 'model:switch':
        bus.emit({ type: 'internal:model-switch', key: m.key })
        break
      case 'model:custom-add':
        bus.emit({ type: 'internal:custom-add', baseURL: m.baseURL, apiKey: m.apiKey, modelName: m.modelName, adapt: m.adapt })
        break
      case 'model:custom-delete':
        bus.emit({ type: 'internal:custom-delete', id: m.id })
        break
      case 'model:set-key':
        bus.emit({ type: 'internal:set-key', key: m.key, apiKey: m.apiKey, force: m.force })
        break
      case 'model:set-thinking':
        bus.emit({ type: 'internal:set-thinking', enabled: m.enabled })
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
        // 存快照而不是原事件:前端 applyForceResult 本身是并集语义(加 forced、减
        // released),把历次增量累积成一条 forced=全集 的等价消息重放即可完整恢复,
        // 前端不用改。广播出去的仍是原始增量 sm。
        // ponytail: 天花板两档,都得改别处才能修,这里只做累积。
        // 一、server 进程重启会丢这份累积——runtime 没有「列出已强制」的查询,
        //     真要覆盖得持久化或给 runtime 加接口。
        // 二、Run / 重新构建会让运行时里的强制失效,但 sticky 和前端 store 都不会清,
        //     重连的客户端会看到已经不存在的强制。这是既有行为(在线客户端本来也不清),
        //     累积快照只是让重连后一样错,不算回归;要修得让 plc-controller 在 buildAndRun
        //     之后 emit 一条 released=全集。
        if (sm.type === 'plc:force-result') {
          const prev = this.sticky.get('plc:force-result') as typeof sm | undefined
          const names = new Set(prev?.forced ?? [])
          for (const n of sm.forced) names.add(n)
          for (const n of sm.released) names.delete(n)
          this.sticky.set(sm.type, { type: 'plc:force-result', forced: [...names], released: [], failed: [], error: null })
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
