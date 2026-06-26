import { describe, it, expect, beforeEach } from 'vitest'
import { useLogsStore, subscribeLogsToWs } from '../src/store/logs'
import type { ServerMessage } from '../shared/protocol'

// agent 路径走块事件（agent:block-start/block-end），不走 tool-start/complete 配对；
// 手动路径（plc-controller）仍走 agent:tool-start/tool-complete 配对（raw input + duration）。

function makeFakeClient() {
  const listeners: ((m: ServerMessage) => void)[] = []
  return {
    client: { on: (cb: (m: ServerMessage) => void) => { listeners.push(cb); return () => {} } } as any,
    emit: (m: ServerMessage) => listeners.forEach((l) => l(m)),
  }
}

beforeEach(() => {
  useLogsStore.getState().clear()
})

describe('logs store tool-complete merge', () => {
  it('agent path (no tool-start): falls back to title for input, no duration', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({
      type: 'agent:tool-complete',
      toolId: 't1',
      name: 'mcp__plc-tools__plc_status',
      result: '{"status":"RUNNING"}',
      isError: false,
      title: 'detail: true',
    } as ServerMessage)

    const entries = useLogsStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].toolName).toBe('plc_status')
    expect(entries[0].toolInput).toBe('detail: true')
    expect(entries[0].toolOutput).toEqual({ status: 'RUNNING' })
    expect(entries[0].message).not.toMatch(/\(\d+ms\)/)
  })

  it('paired path (plc-controller emits start): raw input + duration win over title', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({ type: 'agent:tool-start', toolId: 'u1', name: 'plc_buildAndRun', input: { stCode: 'PROGRAM…' } } as ServerMessage)
    emit({
      type: 'agent:tool-complete',
      toolId: 'u1',
      name: 'plc_buildAndRun',
      result: { success: true },
      isError: false,
    } as ServerMessage)

    const entries = useLogsStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].toolInput).toEqual({ stCode: 'PROGRAM…' })
    expect(entries[0].message).toMatch(/\(\d+ms\)/)
  })

  it('error path: raw input from the error frame wins over title', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({
      type: 'agent:tool-complete',
      toolId: 'e1',
      name: 'mcp__plc-tools__plc_compile',
      result: 'compile failed: syntax error',
      isError: true,
      title: 'stPath: "a.st"',
      input: { stPath: 'a.st' },
    } as ServerMessage)

    const entries = useLogsStore.getState().entries
    expect(entries[0].toolInput).toEqual({ stPath: 'a.st' })
    expect(entries[0].isToolError).toBe(true)
  })

  it('assigns a unique increasing id to every entry (stable identity for UI)', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({ type: 'workspace:ready', path: '/tmp/ws' } as ServerMessage)
    emit({ type: 'plc:state', status: 'RUNNING' } as ServerMessage)

    const entries = useLogsStore.getState().entries
    expect(entries).toHaveLength(2)
    expect(typeof entries[0].id).toBe('number')
    expect(entries[1].id).toBeGreaterThan(entries[0].id)
  })
})

describe('logs store: agent 路径走块事件', () => {
  it('block-start/end(tool) 配对生成 ✓ 条目（带 input + duration）', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({ type: 'agent:block-start', turnId: 'T1', blockId: 'b1', kind: 'tool', toolName: 'mcp__plc-tools__plc_compile', input: { f: 1 } } as ServerMessage)
    emit({ type: 'agent:block-end', turnId: 'T1', blockId: 'b1', kind: 'tool', toolName: 'mcp__plc-tools__plc_compile', result: { ok: true, content: 'done' } } as ServerMessage)
    const entries = useLogsStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].message).toMatch(/✓ plc_compile/)
    expect(entries[0].toolInput).toEqual({ f: 1 })
    expect(entries[0].isToolError).toBe(false)
  })

  it('error 结果生成 ✗ 条目', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({ type: 'agent:block-end', turnId: 'T1', blockId: 'b2', kind: 'tool', toolName: 'plc_x', result: { ok: false, content: 'boom\ndetail' } } as ServerMessage)
    const entries = useLogsStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].message).toMatch(/✗ plc_x/)
    expect(entries[0].isToolError).toBe(true)
  })

  it('强制关块的空结果（todo 类）不产生日志条目', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({ type: 'agent:block-start', turnId: 'T1', blockId: 'b3', kind: 'tool', toolName: 'create_todo', input: {} } as ServerMessage)
    emit({ type: 'agent:block-end', turnId: 'T1', blockId: 'b3', kind: 'tool', toolName: 'create_todo', result: { ok: true, content: '' } } as ServerMessage)
    expect(useLogsStore.getState().entries).toHaveLength(0)
  })

  it('thinking/text 的 block 事件不进日志', () => {
    const { client, emit } = makeFakeClient()
    subscribeLogsToWs(client)
    emit({ type: 'agent:block-start', turnId: 'T1', blockId: 'th', kind: 'thinking' } as ServerMessage)
    emit({ type: 'agent:block-end', turnId: 'T1', blockId: 'th', kind: 'thinking', durationMs: 100 } as ServerMessage)
    expect(useLogsStore.getState().entries).toHaveLength(0)
  })
})
