import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomInt } from 'crypto'
import WebSocket from 'ws'
import { WsGateway } from '../../server/ws-gateway.js'
import { bus } from '../../server/event-bus.js'

const TEST_PORT = 13002 + randomInt(1000)
let gateway: WsGateway

beforeEach(() => {
  gateway = new WsGateway({ port: TEST_PORT })
})
afterEach(() => {
  gateway.close()
  bus.removeAllListeners()
})

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

describe('WsGateway', () => {
  it('relays user:input to internal:user-input on bus', async () => {
    const events: any[] = []
    bus.on((m) => events.push(m))

    const ws = await open()
    ws.send(JSON.stringify({ type: 'user:input', text: 'hi' }))
    await new Promise(r => setTimeout(r, 30))

    expect(events.some(e => e.type === 'internal:user-input' && e.text === 'hi')).toBe(true)
    ws.close()
    await new Promise(r => setTimeout(r, 20))
  })

  it('broadcasts ServerMessages from bus to all clients (multi-client)', async () => {
    const c1 = await open()
    const c2 = await open()
    const r1: string[] = []
    const r2: string[] = []
    c1.on('message', (d) => r1.push(d.toString()))
    c2.on('message', (d) => r2.push(d.toString()))

    bus.emit({ type: 'plc:state', status: 'RUNNING' })
    await new Promise(r => setTimeout(r, 30))

    expect(r1.some(s => JSON.parse(s).type === 'plc:state')).toBe(true)
    expect(r2.some(s => JSON.parse(s).type === 'plc:state')).toBe(true)

    c1.close(); c2.close()
    await new Promise(r => setTimeout(r, 20))
  })

  it('does NOT broadcast internal: events', async () => {
    const ws = await open()
    const received: string[] = []
    ws.on('message', (d) => received.push(d.toString()))

    bus.emit({ type: 'internal:user-input', text: 'should-not-broadcast' })
    await new Promise(r => setTimeout(r, 30))

    expect(received).toEqual([])
    ws.close()
    await new Promise(r => setTimeout(r, 20))
  })

  it('ignores invalid JSON without crashing', async () => {
    const ws = await open()
    const received: any[] = []
    ws.on('message', (d) => received.push(JSON.parse(d.toString())))

    ws.send('not json')
    await new Promise(r => setTimeout(r, 30))

    expect(received.some(m => m.type === 'error')).toBe(true)
    ws.close()
    await new Promise(r => setTimeout(r, 20))
  })

  it('replays sticky state to a client that connects AFTER hydration (regression)', async () => {
    const port = TEST_PORT + 2
    const g = new WsGateway({ port })

    // Bus emits BEFORE any client connects — simulating SemaBridge.start() hydration
    bus.emit({ type: 'workspace:ready', path: '/tmp/sticky-test', sessionId: 'sid-1' })
    bus.emit({ type: 'plc:variables', map: [{ index: 0, name: 'a', type: 'BOOL', location: '%QX0.0' }] })
    bus.emit({ type: 'editor:files', files: [{ path: 'foo.st', mtime: 1 }] })

    // Connect a client — listener attached BEFORE awaiting 'open' so we don't
    // race against the server-side sticky replay.
    const received: string[] = []
    const c = new WebSocket(`ws://127.0.0.1:${port}`)
    c.on('message', (d) => received.push(JSON.parse(d.toString()).type))
    await new Promise<void>((resolve, reject) => {
      c.on('open', () => resolve())
      c.on('error', reject)
    })
    await new Promise(r => setTimeout(r, 50))

    expect(received).toContain('workspace:ready')
    expect(received).toContain('plc:variables')
    expect(received).toContain('editor:files')

    c.close()
    g.close()
    await new Promise(r => setTimeout(r, 20))
  })

  // 重连后要能解掉运行时里仍生效的强制 ⇒ 重放的必须是累积后的全集,
  // 直接 sticky 原事件只会恢复最后一次操作(这里就是 release A,forced 空)。
  it('replays the accumulated forced set to a reconnecting client', async () => {
    const port = TEST_PORT + 3
    const g = new WsGateway({ port })

    const fr = (forced: string[], released: string[]) =>
      bus.emit({ type: 'plc:force-result', forced, released, failed: [], error: null })
    fr(['a'], [])
    fr(['b'], [])
    fr([], ['a'])

    const received: any[] = []
    const c = new WebSocket(`ws://127.0.0.1:${port}`)
    c.on('message', (d) => received.push(JSON.parse(d.toString())))
    await new Promise<void>((resolve, reject) => {
      c.on('open', () => resolve())
      c.on('error', reject)
    })
    await new Promise(r => setTimeout(r, 50))

    const replay = received.find(m => m.type === 'plc:force-result')
    expect(replay).toBeDefined()
    expect([...replay.forced].sort()).toEqual(['b'])
    expect(replay.released).toEqual([])

    c.close()
    g.close()
    await new Promise(r => setTimeout(r, 20))
  })

  it('invokes onConnect / onDisconnect callbacks per connection', async () => {
    let connectCount = 0
    let disconnectCount = 0
    // Use a separate port so we don't conflict with the beforeEach gateway
    const port = TEST_PORT + 1
    const g = new WsGateway({
      port,
      onConnect: () => { connectCount++ },
      onDisconnect: () => { disconnectCount++ },
    })

    const c = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`)
      ws.on('open', () => resolve(ws))
      ws.on('error', reject)
    })
    await new Promise(r => setTimeout(r, 20))
    expect(connectCount).toBe(1)

    c.close()
    await new Promise(r => setTimeout(r, 30))
    expect(disconnectCount).toBe(1)

    g.close()
  })
})
