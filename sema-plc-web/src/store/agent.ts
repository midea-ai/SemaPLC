import { create } from 'zustand'
import type { WsClient } from '../ws/client'
import type { TodoItem, AgentBlock, SerializedTurn, ServerMessage, ToolBlockResult } from '../../shared/protocol'

export type ChatMessage =
  | { id: string; kind: 'user'; text: string; ts: number }
  | { id: string; kind: 'agent'; blocks: AgentBlock[]; status: 'streaming' | 'done' | 'error' | 'interrupted'; ts: number }
  // 手动运行（plc-controller 的 Run/Stop/Force 按钮）——独立卡片，不属于任何 turn
  | { id: string; kind: 'manual-tool'; toolName: string; input?: unknown; result?: ToolBlockResult; status: 'running' | 'success' | 'error'; ts: number }
  | { id: string; kind: 'error'; text: string; ts: number }

interface AgentStore {
  messages: ChatMessage[]
  state: 'idle' | 'processing'
  todos: TodoItem[]
  sessionId: string | null
  appendUser: (text: string) => void
  setState: (s: 'idle' | 'processing') => void
  setTodos: (t: TodoItem[]) => void
  clear: () => void
}

// ── blocks 不可变更新辅助：只替换变化的块对象（React.memo 依赖引用稳定） ──
function upsertTurn(messages: ChatMessage[], turnId: string): ChatMessage[] {
  if (messages.some((m) => m.id === turnId)) return messages
  return [...messages, { id: turnId, kind: 'agent', blocks: [], status: 'streaming', ts: Date.now() }]
}
function updateTurn(messages: ChatMessage[], turnId: string, fn: (m: Extract<ChatMessage, { kind: 'agent' }>) => ChatMessage): ChatMessage[] {
  return messages.map((m) => (m.id === turnId && m.kind === 'agent' ? fn(m) : m))
}
function updateBlock(blocks: AgentBlock[], blockId: string, fn: (b: AgentBlock) => AgentBlock): AgentBlock[] {
  return blocks.map((b) => (b.id === blockId ? fn(b) : b))
}

export const useAgentStore = create<AgentStore>((set) => ({
  messages: [],
  state: 'idle',
  todos: [],
  sessionId: null,
  setTodos: (todos) => set({ todos }),
  appendUser: (text) => set((s) => ({
    messages: [...s.messages, { id: `u-${Date.now()}`, kind: 'user', text, ts: Date.now() }],
  })),
  setState: (state) => set({ state }),
  clear: () => set({ messages: [], state: 'idle', todos: [], sessionId: null }),
}))

/** WS 事件 → store。导出供测试直接驱动（不经 WsClient）。 */
export function handleAgentWsMessage(m: ServerMessage): void {
  const st = useAgentStore
  switch (m.type) {
    case 'agent:user-input-received':
      st.getState().appendUser(m.text)
      break
    case 'agent:turn-start':
      st.setState((s) => ({ messages: upsertTurn(s.messages, m.turnId) }))
      break
    case 'agent:block-start':
      st.setState((s) => {
        const messages = upsertTurn(s.messages, m.turnId)
        const block: AgentBlock =
          m.kind === 'thinking' ? { kind: 'thinking', id: m.blockId, text: '', streaming: true }
          : m.kind === 'text' ? { kind: 'text', id: m.blockId, text: '', streaming: true }
          : { kind: 'tool', id: m.blockId, toolName: m.toolName ?? '?', input: m.input, status: 'running' }
        return { messages: updateTurn(messages, m.turnId, (t) =>
          t.blocks.some((b) => b.id === m.blockId) ? t : { ...t, blocks: [...t.blocks, block] }) }
      })
      break
    case 'agent:block-delta':
      st.setState((s) => {
        let messages = upsertTurn(s.messages, m.turnId)
        messages = updateTurn(messages, m.turnId, (t) => {
          // 懒建：未知 blockId（中途重连）→ 默认 text 块；tool 的流式输出走 streamText
          if (!t.blocks.some((b) => b.id === m.blockId)) {
            return { ...t, blocks: [...t.blocks, { kind: 'text', id: m.blockId, text: m.delta, streaming: true }] }
          }
          return { ...t, blocks: updateBlock(t.blocks, m.blockId, (b) =>
            b.kind === 'tool' ? { ...b, streamText: (b.streamText ?? '') + m.delta }
            : { ...b, text: b.text + m.delta }) }
        })
        return { messages }
      })
      break
    case 'agent:block-end':
      st.setState((s) => {
        let messages = upsertTurn(s.messages, m.turnId)
        messages = updateTurn(messages, m.turnId, (t) => {
          // 懒建：无 start 的 end（error 兜底）——end 自带 kind/toolName 足以渲染
          if (!t.blocks.some((b) => b.id === m.blockId)) {
            const nb: AgentBlock = m.kind === 'tool'
              ? { kind: 'tool', id: m.blockId, toolName: m.toolName ?? '?', result: m.result, status: m.result?.ok === false ? 'error' : 'success' }
              : m.kind === 'thinking' ? { kind: 'thinking', id: m.blockId, text: '', streaming: false, durationMs: m.durationMs }
              : { kind: 'text', id: m.blockId, text: '', streaming: false }
            return { ...t, blocks: [...t.blocks, nb] }
          }
          return { ...t, blocks: updateBlock(t.blocks, m.blockId, (b) => {
            // kind 错配（懒建 text 块 + 真 end 是别的 kind）→ 按 end 载荷重建，防静默丢 result
            if (b.kind !== m.kind) {
              return m.kind === 'tool'
                ? { kind: 'tool', id: m.blockId, toolName: m.toolName ?? '?', result: m.result, status: m.result?.ok === false ? 'error' : 'success' }
                : m.kind === 'thinking'
                ? { kind: 'thinking', id: m.blockId, text: b.kind !== 'tool' ? b.text : '', streaming: false, durationMs: m.durationMs }
                : { kind: 'text', id: m.blockId, text: b.kind !== 'tool' ? b.text : '', streaming: false }
            }
            if (b.kind === 'tool') return { ...b, result: m.result, status: m.result?.ok === false ? 'error' : 'success' }
            if (b.kind === 'thinking') return { ...b, streaming: false, durationMs: m.durationMs }
            return { ...b, streaming: false }
          }) }
        })
        return { messages }
      })
      break
    case 'agent:turn-end':
      st.setState((s) => ({ messages: updateTurn(s.messages, m.turnId, (t) => ({ ...t, status: m.status })) }))
      break
    case 'agent:turn-snapshot':
      if (m.turn) {
        const turn: SerializedTurn = m.turn
        st.setState((s) => {
          const exists = s.messages.some((x) => x.id === turn.turnId)
          if (exists) {
            return { messages: updateTurn(s.messages, turn.turnId, (t) => ({ ...t, blocks: turn.blocks })) }
          }
          return { messages: [...s.messages, { id: turn.turnId, kind: 'agent', blocks: turn.blocks, status: 'streaming', ts: Date.now() }] }
        })
      }
      break
    // ── 手动运行（plc-controller）——独立卡片 ──
    case 'agent:tool-start':
      st.setState((s) => ({ messages: [...s.messages, { id: m.toolId, kind: 'manual-tool', toolName: m.name, input: m.input, status: 'running', ts: Date.now() }] }))
      break
    case 'agent:tool-complete':
      st.setState((s) => ({ messages: s.messages.map((x) => x.id === m.toolId && x.kind === 'manual-tool'
        ? { ...x, status: m.isError ? 'error' : 'success', result: { ok: !m.isError, content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result, null, 2) ?? '' } }
        : x) }))
      break
    case 'agent:state':
      st.getState().setState(m.state)
      break
    case 'agent:todos':
      st.getState().setTodos(m.todos)
      break
    case 'error':
      st.setState((s) => ({ messages: [...s.messages, { id: `e-${Date.now()}`, kind: 'error', text: m.message, ts: Date.now() }] }))
      break
    case 'workspace:ready':
      // 同 sessionId = 同会话的 WS 重连（sticky 重放）→ 不清空（spec H4）；
      // sessionId 变化 = reset/switch 后的新会话 → 清空。
      st.setState((s) => s.sessionId === m.sessionId ? {} : { messages: [], todos: [], state: 'idle', sessionId: m.sessionId })
      // 首次（sessionId 为 null）也走上面分支完成记录
      break
    case 'workspace:switching':
      st.getState().clear()
      break
  }
}

export function subscribeAgentToWs(client: WsClient) {
  client.on(handleAgentWsMessage)
}
