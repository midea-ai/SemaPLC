// tests/group-blocks.test.ts
import { describe, it, expect } from 'vitest'
import { groupBlocks } from '../src/components/left/blocks/tools/groupBlocks'
import type { AgentBlock } from '../shared/protocol'

const tool = (id: string, toolName: string, status: any = 'success', input?: any): AgentBlock => ({ kind: 'tool', id, toolName, status, input })
const text = (id: string): AgentBlock => ({ kind: 'text', id, text: 'hi', streaming: false })

describe('groupBlocks', () => {
  it('groups >=2 consecutive groupable read tools', () => {
    const items = groupBlocks([tool('a', 'view_file'), tool('b', 'view_file'), tool('c', 'search_files')])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('group')
    if (items[0].kind === 'group') expect(items[0].blocks).toHaveLength(3)
  })
  it('does not group a single groupable tool', () => {
    const items = groupBlocks([tool('a', 'view_file'), text('t')])
    expect(items.every((i) => i.kind === 'block')).toBe(true)
  })
  it('text/non-explore tool breaks the run', () => {
    const items = groupBlocks([tool('a', 'view_file'), text('t'), tool('b', 'view_file')])
    expect(items).toHaveLength(3)
    expect(items.every((i) => i.kind === 'block')).toBe(true)
  })
  it('does not group while a tool is still running', () => {
    const items = groupBlocks([tool('a', 'view_file', 'running'), tool('b', 'view_file')])
    expect(items.every((i) => i.kind === 'block')).toBe(true)
  })
  it('run_shell groups only when exploratory', () => {
    const g = groupBlocks([tool('a', 'run_shell', 'success', { command: 'ls -la' }), tool('b', 'view_file')])
    expect(g[0].kind).toBe('group')
    const ng = groupBlocks([tool('a', 'run_shell', 'success', { command: 'rm -rf x' }), tool('b', 'view_file')])
    expect(ng.every((i) => i.kind === 'block')).toBe(true)
  })
})
