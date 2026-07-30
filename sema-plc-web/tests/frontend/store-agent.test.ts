import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore, subscribeAgentToWs, handleAgentWsMessage, flushAgentPersist } from '../../src/store/agent'
import type { ServerMessage } from '../../shared/protocol'

beforeEach(async () => {
  const { useAgentStore } = await import('../../src/store/agent')
  useAgentStore.getState().clear()
})

describe('useAgentStore', () => {
  it('appendUser adds a user message', async () => {
    const { useAgentStore } = await import('../../src/store/agent')
    useAgentStore.getState().appendUser('hello')
    const m = useAgentStore.getState().messages
    expect(m).toHaveLength(1)
    expect(m[0].kind).toBe('user')
    expect(m[0].text).toBe('hello')
  })
})

describe('agent store — todos', () => {
  it('agent:todos updates the todos list', () => {
    useAgentStore.getState().clear()
    // capture the ws handler subscribeAgentToWs registers
    let handler: ((m: ServerMessage) => void) | undefined
    subscribeAgentToWs({ on: (cb: any) => { handler = cb } } as any)
    handler!({ type: 'agent:todos', todos: [
      { id: '1', title: '验证', status: 'in_progress', progressText: 'force 传感器' },
    ] } as ServerMessage)
    expect(useAgentStore.getState().todos).toEqual([
      { id: '1', title: '验证', status: 'in_progress', progressText: 'force 传感器' },
    ])
  })
  it('clear() empties todos', () => {
    useAgentStore.getState().setTodos([{ id: '1', title: 'x', status: 'pending' }])
    useAgentStore.getState().clear()
    expect(useAgentStore.getState().todos).toEqual([])
  })
})

// 刷新网页 → store 重建从 localStorage 恢复(persist)。这是修“刷新丢聊天历史”的回归保护。
describe('agent store — 刷新持久化 (persist)', () => {
  beforeEach(() => {
    useAgentStore.getState().clear()
    localStorage.clear()
  })

  it('刷新后 persist 从 localStorage 自动 hydrate 恢复历史', async () => {
    // 等价于"上次会话已落盘 → 浏览器刷新 → store 重建时 persist 自动 hydrate"。
    // （注意：真实刷新不调 clear()——那会把空值写回 storage；这里是手动落盘后直接 rehydrate。）
    localStorage.setItem('semaplc:agent-chat', JSON.stringify({
      state: { sessionId: null, messages: [
        { id: 'u1', kind: 'user', text: 'hi', ts: 1 },
        { id: 't1', kind: 'agent', blocks: [], status: 'done', ts: 2 },
      ] },
      version: 0,
    }))
    expect(useAgentStore.getState().messages).toHaveLength(0)
    await useAgentStore.persist.rehydrate()
    expect(useAgentStore.getState().messages.map((m) => m.kind)).toEqual(['user', 'agent'])
  })

  it('写入后落盘，且 partialize 只存 messages + sessionId（不存瞬时态）', () => {
    useAgentStore.getState().appendUser('hello')
    handleAgentWsMessage({ type: 'agent:turn-start', turnId: 'T1' })
    handleAgentWsMessage({ type: 'agent:turn-end', turnId: 'T1', status: 'done' })
    flushAgentPersist()   // 落盘是 300ms throttle 的尾沿写,同步读前先 flush
    const parsed = JSON.parse(localStorage.getItem('semaplc:agent-chat')!)
    expect(parsed.state.messages.map((m: { kind: string }) => m.kind)).toEqual(['user', 'agent'])
    expect(parsed.state).not.toHaveProperty('state')
    expect(parsed.state).not.toHaveProperty('todos')
  })

  it('streaming 的进行中 turn 不持久化（避免刷新后卡死在 streaming）', () => {
    handleAgentWsMessage({ type: 'agent:turn-start', turnId: 'Ts' }) // turn 容器默认 status=streaming
    flushAgentPersist()
    const raw = localStorage.getItem('semaplc:agent-chat')!
    const parsed = JSON.parse(raw)
    expect(parsed.state.messages).toHaveLength(0) // 被 partialize 过滤掉
  })

  // 落盘走 300ms throttle 尾沿:关页面落在窗口内会丢最后一批消息 → pagehide 必须同步 flush。
  it('pagehide 同步 flush 未落盘的消息（不等 300ms）', () => {
    useAgentStore.getState().appendUser('末条消息')
    expect(localStorage.getItem('semaplc:agent-chat')).toBeNull()   // throttle 窗口内还没写
    window.dispatchEvent(new Event('pagehide'))
    const parsed = JSON.parse(localStorage.getItem('semaplc:agent-chat')!)
    expect(parsed.state.messages.map((m: { text: string }) => m.text)).toEqual(['末条消息'])
  })
})
