import { describe, it, expect, vi, beforeEach } from 'vitest'

// Polyfill WebSocket for jsdom env if needed
class MockWebSocket {
  static OPEN = 1
  static CLOSED = 3
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0)
  }
  send(_data: string) {}
  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }
}

beforeEach(() => {
  (globalThis as any).WebSocket = MockWebSocket as any
})

describe('WsClient', () => {
  it('emits status="open" after connect', async () => {
    const mod = await import('../../src/ws/client')
    const { WsClient } = mod
    const client = new WsClient('ws://test')
    const states: string[] = []
    client.onStatus(s => states.push(s))
    client.connect()
    await new Promise(r => setTimeout(r, 10))
    expect(states).toContain('open')
  })

  it('decodes ServerMessage and notifies listeners', async () => {
    const { WsClient } = await import('../../src/ws/client')
    const client = new WsClient('ws://test')
    const received: any[] = []
    client.on(m => received.push(m))
    client.connect()
    await new Promise(r => setTimeout(r, 10))

    // Inject a message
    const ws = (client as any).ws as MockWebSocket
    ws.onmessage?.({ data: JSON.stringify({ type: 'plc:state', status: 'RUNNING' }) })

    expect(received).toEqual([{ type: 'plc:state', status: 'RUNNING' }])
  })

  it('ignores malformed JSON', async () => {
    const { WsClient } = await import('../../src/ws/client')
    const client = new WsClient('ws://test')
    const received: any[] = []
    client.on(m => received.push(m))
    client.connect()
    await new Promise(r => setTimeout(r, 10))

    const ws = (client as any).ws as MockWebSocket
    ws.onmessage?.({ data: 'not json' })

    expect(received).toEqual([])
  })
})
