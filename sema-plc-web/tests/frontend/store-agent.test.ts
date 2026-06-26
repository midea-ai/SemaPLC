import { describe, it, expect, beforeEach } from 'vitest'
import { useAgentStore, subscribeAgentToWs } from '../../src/store/agent'
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
