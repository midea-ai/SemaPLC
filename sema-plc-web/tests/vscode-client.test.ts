// @vitest-environment jsdom
// VscodeWsClient 是侧边栏的全部收发通道 —— 信封格式与 sema-plc-vscode/src/bus.ts 是
// 一份口头协议,两边对不上的表现是「对话发不出去」或「界面一直转圈」,而不是报错。
import { describe, it, expect, beforeEach, vi } from 'vitest'

const posted: unknown[] = []

// acquireVsCodeApi 必须在 import 被测模块之前挂上:confirmDialog.ts 的 vscodeApi() 是
// 模块级 memo,第一次调用的结果会被一直用下去。
;(globalThis as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
  postMessage: (m: unknown) => posted.push(m),
})

const { VscodeWsClient } = await import('../src/ws/vscodeClient')

/** 模拟扩展宿主 → webview 的一条 postMessage */
const fromHost = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }))

describe('VscodeWsClient', () => {
  beforeEach(() => {
    posted.length = 0
  })

  it('构造时就发 view:ready —— 全量重放由它触发,晚一点都会丢消息', () => {
    new VscodeWsClient('chat')
    expect(posted).toEqual([{ type: 'view:ready', view: 'chat' }])
  })

  it('send 包成 ws:send 信封,不做 open 检查', () => {
    const c = new VscodeWsClient('chat')
    posted.length = 0
    c.send({ type: 'agent:prompt', text: 'hi' } as never)
    // 状态是 connecting(还没收到过 ws:status),照样要发出去 ——
    // WS 的真实状态在扩展那侧,这里按一份可能过期的副本丢消息只会丢错。
    expect(c.getStatus()).toBe('connecting')
    expect(posted).toEqual([{ type: 'ws:send', payload: { type: 'agent:prompt', text: 'hi' } }])
  })

  it('ws:message 分发给订阅者,ws:status 驱动状态', () => {
    const c = new VscodeWsClient('chat')
    const seen: unknown[] = []
    const statuses: string[] = []
    c.on((m) => seen.push(m))
    c.onStatus((s) => statuses.push(s))

    fromHost({ type: 'ws:message', payload: { type: 'agent:state', state: 'thinking' } })
    fromHost({ type: 'ws:status', status: 'open' })

    expect(seen).toEqual([{ type: 'agent:state', state: 'thinking' }])
    expect(statuses).toEqual(['open'])
    expect(c.getStatus()).toBe('open')
  })

  it('一个订阅者抛异常,同一条消息的其余订阅者照样收到', () => {
    const c = new VscodeWsClient('chat')
    const seen: unknown[] = []
    c.on(() => {
      throw new Error('boom')
    })
    c.on((m) => seen.push(m))

    fromHost({ type: 'ws:message', payload: { type: 'agent:state', state: 'idle' } })
    expect(seen).toHaveLength(1)
  })

  it('退订后不再收到', () => {
    const c = new VscodeWsClient('chat')
    const seen: unknown[] = []
    const off = c.on((m) => seen.push(m))
    off()
    fromHost({ type: 'ws:message', payload: { type: 'agent:state', state: 'idle' } })
    expect(seen).toEqual([])
  })

  it('不认识的消息一律忽略,不能抛 —— window 上的 message 事件不止我们一家在发', () => {
    const c = new VscodeWsClient('chat')
    const seen: unknown[] = []
    c.on((m) => seen.push(m))
    expect(() => {
      fromHost(null)
      fromHost('some string')
      fromHost({ type: 'semaplc:confirm-result', id: 1, ok: true })
    }).not.toThrow()
    expect(seen).toEqual([])
  })
})

describe('wireStores 按需订阅', () => {
  it('只订指定的 store,不碰其余的', async () => {
    vi.resetModules()
    const { wireStores } = await import('../src/store')
    const subscribed: string[] = []
    const client = {
      getStatus: () => 'open' as const,
      send: () => {},
      on: (cb: (m: never) => void) => {
        // 每个 subscribeXxxToWs 都会调一次 client.on —— 用调用次数反推订了几个
        subscribed.push(String(cb.name || 'anon'))
        return () => {}
      },
      onStatus: () => () => {},
    }
    wireStores(client, ['agent', 'model'])
    expect(subscribed).toHaveLength(2)
  })
})
