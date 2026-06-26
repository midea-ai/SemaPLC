import { EventEmitter } from 'events'
import type { ServerMessage } from '../shared/protocol.js'

/**
 * Internal event bus that decouples sema-bridge / plc-controller / plc-monitor
 * from ws-gateway. Producers emit ServerMessage; ws-gateway subscribes and
 * broadcasts to all clients.
 *
 * Also carries internal commands not in protocol (e.g. 'user:input' relay
 * from ws-gateway to sema-bridge). These use the 'internal:' prefix.
 */
export type InternalMessage =
  | { type: 'internal:user-input'; text: string }
  | { type: 'internal:plc-run'; stCode: string }
  | { type: 'internal:plc-stop' }
  | { type: 'internal:plc-fetch-logs'; lines?: number }
  | { type: 'internal:plc-force'; set?: Record<string, number | boolean>; release?: string[] }
  | { type: 'internal:agent-interrupt' }
  | { type: 'internal:workspace-switch'; path: string }
  | { type: 'internal:editor-save'; path?: string; stCode: string }
  | { type: 'internal:editor-open'; path: string }   // P2
  | { type: 'internal:session-reset' }
  | { type: 'internal:client-connected' }

export type BusMessage = ServerMessage | InternalMessage

class TypedBus {
  private ee = new EventEmitter()
  constructor() { this.ee.setMaxListeners(50) }

  emit(msg: BusMessage): void {
    this.ee.emit('msg', msg)
  }
  on(handler: (msg: BusMessage) => void): () => void {
    this.ee.on('msg', handler)
    return () => this.ee.off('msg', handler)
  }
  removeAllListeners(): void {
    this.ee.removeAllListeners('msg')
  }
}

export const bus = new TypedBus()
