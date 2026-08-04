import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore, handleAgentWsMessage } from '../src/store/agent'
import type { ServerMessage, TodoItem } from '../shared/protocol'

const h = (m: ServerMessage) => handleAgentWsMessage(m)
beforeEach(() => useAgentStore.getState().clear())

describe('agent store: blocks 消息模型', () => {
  it('turn-start→block 流→turn-end：一条 agent 消息按序聚合三类块', () => {
    h({ type: 'agent:turn-start', turnId: 'T1' })
    h({ type: 'agent:block-start', turnId: 'T1', blockId: 'b1', kind: 'thinking' })
    h({ type: 'agent:block-delta', turnId: 'T1', blockId: 'b1', delta: '想想' })
    h({ type: 'agent:block-end', turnId: 'T1', blockId: 'b1', kind: 'thinking', durationMs: 1200 })
    h({ type: 'agent:block-start', turnId: 'T1', blockId: 't1', kind: 'tool', toolName: 'plc_compile', input: { f: 'a.st' } })
    h({ type: 'agent:block-end', turnId: 'T1', blockId: 't1', kind: 'tool', toolName: 'plc_compile', result: { ok: true, content: 'ok' } })
    h({ type: 'agent:block-start', turnId: 'T1', blockId: 'x1', kind: 'text' })
    h({ type: 'agent:block-delta', turnId: 'T1', blockId: 'x1', delta: '完成' })
    h({ type: 'agent:turn-end', turnId: 'T1', status: 'done' })
    const msgs = useAgentStore.getState().messages
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    if (m.kind !== 'agent') throw new Error('expect agent message')
    expect(m.status).toBe('done')
    expect(m.blocks.map((b) => b.kind)).toEqual(['thinking', 'tool', 'text'])
    expect((m.blocks[0] as any).durationMs).toBe(1200)
    expect((m.blocks[1] as any).status).toBe('success')
    expect((m.blocks[2] as any).text).toBe('完成')
  })

  it('懒建：未知 turnId 的 delta 合成 turn 容器+text 块（断线重连续流）', () => {
    h({ type: 'agent:block-delta', turnId: 'T9', blockId: 'bx', delta: '后半段' })
    const m = useAgentStore.getState().messages[0]
    if (m.kind !== 'agent') throw new Error('expect agent message')
    expect(m.status).toBe('streaming')
    expect(m.blocks[0]).toMatchObject({ kind: 'text', id: 'bx', text: '后半段' })
  })

  it('懒建：未知 blockId 的 block-end(tool) 也能独立渲染（无 start 的 error 兜底）', () => {
    h({ type: 'agent:turn-start', turnId: 'T1' })
    h({ type: 'agent:block-end', turnId: 'T1', blockId: 'te', kind: 'tool', toolName: 'plc_x', result: { ok: false, content: 'boom' } })
    const m = useAgentStore.getState().messages[0]
    if (m.kind !== 'agent') throw new Error('expect agent message')
    expect(m.blocks[0]).toMatchObject({ kind: 'tool', toolName: 'plc_x', status: 'error' })
  })

  it('快照应用：替换/新建当前 turn；null 快照 no-op', () => {
    h({ type: 'agent:turn-snapshot', turn: { turnId: 'T1', blocks: [
      { kind: 'thinking', id: 'b1', text: '想', streaming: true },
      { kind: 'tool', id: 't1', toolName: 'plc_trace', status: 'running' },
    ] } })
    let msgs = useAgentStore.getState().messages
    expect(msgs).toHaveLength(1)
    h({ type: 'agent:block-delta', turnId: 'T1', blockId: 'b1', delta: '更多' })
    msgs = useAgentStore.getState().messages
    expect((msgs[0] as any).blocks[0].text).toBe('想更多')
    h({ type: 'agent:turn-snapshot', turn: null })
    expect(useAgentStore.getState().messages).toHaveLength(1)
  })

  it('workspace:ready 同 sessionId 不清空（WS 重连保留聊天），换 sessionId 才清', () => {
    h({ type: 'agent:turn-start', turnId: 'T1' })
    h({ type: 'workspace:ready', path: '/w', sessionId: 'S1' })  // 首次记录
    h({ type: 'agent:block-delta', turnId: 'T1', blockId: 'b', delta: 'x' })
    h({ type: 'workspace:ready', path: '/w', sessionId: 'S1' })  // 重连重放 → 不清
    expect(useAgentStore.getState().messages.length).toBeGreaterThan(0)
    h({ type: 'workspace:ready', path: '/w', sessionId: 'S2' })  // 新会话 → 清
    expect(useAgentStore.getState().messages).toHaveLength(0)
  })

  it('手动运行：tool-start/complete 渲染为独立 manual-tool 消息', () => {
    h({ type: 'agent:tool-start', toolId: 'mt1', name: 'plc_forceVariables', input: { set: { run: true } } })
    h({ type: 'agent:tool-complete', toolId: 'mt1', name: 'plc_forceVariables', result: { forced: ['run'] }, isError: false })
    const m = useAgentStore.getState().messages[0]
    if (m.kind !== 'manual-tool') throw new Error('expect manual-tool')
    expect(m.status).toBe('success')
  })

  it('turn-end(error) 标记消息 error（重试按钮由 UI 依 state 判断禁用）', () => {
    h({ type: 'agent:turn-start', turnId: 'T1' })
    h({ type: 'agent:turn-end', turnId: 'T1', status: 'error' })
    expect((useAgentStore.getState().messages[0] as any).status).toBe('error')
  })
})

// 原有用例保留：per-turn scoping 在后端（watermark），store 原样存 todos
describe('agent store setTodos (no title-dedup)', () => {
  it('stores todos as-is, keeping distinct ids even with repeated titles', () => {
    const todos: TodoItem[] = [
      { id: '1', title: '行为验证', status: 'completed' },
      { id: '2', title: '行为验证', status: 'in_progress' },
    ]
    useAgentStore.getState().setTodos(todos)
    expect(useAgentStore.getState().todos).toEqual(todos)
  })
})

describe('agent store: 上下文用量 (agent:usage)', () => {
  it('agent:usage 更新 usage；新会话 workspace:ready 清空', () => {
    h({ type: 'agent:usage', useTokens: 15000, maxTokens: 128000 })
    expect(useAgentStore.getState().usage).toEqual({ useTokens: 15000, maxTokens: 128000 })
    h({ type: 'workspace:ready', path: '/w', sessionId: 'S-new' })
    h({ type: 'workspace:ready', path: '/w', sessionId: 'S-newer' })  // sessionId 变 → 清
    expect(useAgentStore.getState().usage).toBeNull()
  })
})
