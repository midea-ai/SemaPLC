import { describe, it, expect } from 'vitest'
import { BlockMapper } from '../server/block-mapper'
import type { ServerMessage } from '../shared/protocol'

/** 收集 emit 的事件 + 可控时钟 */
function setup() {
  const out: ServerMessage[] = []
  let t = 1000
  const clock = { now: () => t, tick: (ms: number) => { t += ms } }
  const mp = new BlockMapper((m) => out.push(m), clock.now)
  const types = () => out.map((m) => m.type)
  return { mp, out, clock, types }
}
const MAIN = 'main'

describe('BlockMapper: turn 懒开启与基本块生命周期', () => {
  it('首个 thinking chunk 懒开启 turn 并开 thinking 块', () => {
    const { mp, out, types } = setup()
    mp.onThinkingChunk({ id: 'm1', delta: '让我想想' })
    expect(types()).toEqual(['agent:turn-start', 'agent:block-start', 'agent:block-delta'])
    const start = out[1] as Extract<ServerMessage, { type: 'agent:block-start' }>
    expect(start.kind).toBe('thinking')
    expect(start.blockId).toBe('m1#thinking-0')
  })

  it('text chunk 关闭同消息的 thinking 块并计算 durationMs（末 chunk 时间为终点）', () => {
    const { mp, out, clock } = setup()
    mp.onThinkingChunk({ id: 'm1', delta: 'a' })
    clock.tick(2000)
    mp.onThinkingChunk({ id: 'm1', delta: 'b' })
    clock.tick(5000) // 工具参数生成等耗时——不得灌进 duration
    mp.onTextChunk({ id: 'm1', delta: '正文' })
    const end = out.find((m) => m.type === 'agent:block-end' && m.blockId === 'm1#thinking-0') as any
    expect(end.durationMs).toBe(2000)
    expect(out.some((m) => m.type === 'agent:block-start' && (m as any).blockId === 'm1#text-0')).toBe(true)
  })

  it('interleaved thinking：同消息第二段 thinking 开新序号块', () => {
    const { mp, out } = setup()
    mp.onThinkingChunk({ id: 'm1', delta: 'a' })
    mp.onTextChunk({ id: 'm1', delta: 't' })
    mp.onThinkingChunk({ id: 'm1', delta: 'b' })
    const starts = out.filter((m) => m.type === 'agent:block-start').map((m: any) => m.blockId)
    expect(starts).toContain('m1#thinking-0')
    expect(starts).toContain('m1#thinking-1')
  })
})

describe('BlockMapper: turn 封口规则（review 核心修正）', () => {
  it('hasToolCalls=true 不封口；跨迭代块同 turn；hasToolCalls=false 才 turn-end(done)', () => {
    const { mp, out, types } = setup()
    mp.onTextChunk({ id: 'm1', delta: '我来编译' })
    mp.onMessageComplete({ id: 'm1', agentId: MAIN, reasoning: '', content: '我来编译', hasToolCalls: true })
    mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'plc_compile', input: { file: 'a.st' } })
    mp.onToolComplete({ agentId: MAIN, toolId: 't1', toolName: 'plc_compile', title: '', summary: '', content: 'ok' })
    mp.onTextChunk({ id: 'm2', delta: '编译成功' })
    expect(types().filter((t) => t === 'agent:turn-end')).toHaveLength(0)
    mp.onMessageComplete({ id: 'm2', agentId: MAIN, reasoning: '', content: '编译成功', hasToolCalls: false })
    const ends = out.filter((m) => m.type === 'agent:turn-end') as any[]
    expect(ends).toHaveLength(1)
    expect(ends[0].status).toBe('done')
    // 全程只有一个 turn-start，且所有块事件共享同一 turnId
    const turnIds = new Set(out.filter((m: any) => m.turnId).map((m: any) => m.turnId))
    expect(out.filter((m) => m.type === 'agent:turn-start')).toHaveLength(1)
    expect(turnIds.size).toBe(1)
  })

  it('idle 兜底封口；interrupted 封口为 interrupted 并关 running 工具', () => {
    const a = setup()
    a.mp.onTextChunk({ id: 'm1', delta: 'x' })
    a.mp.onIdle()
    expect((a.out.at(-1) as any).status).toBe('done')

    const b = setup()
    b.mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', input: {} })
    b.mp.onInterrupted()
    const toolEnd = b.out.find((m) => m.type === 'agent:block-end' && (m as any).blockId === 't1') as any
    expect(toolEnd.result.ok).toBe(false)
    expect((b.out.at(-1) as any).status).toBe('interrupted')
  })
})

describe('BlockMapper: 工具块', () => {
  it('start→chunk→complete 生命周期；chunk 进 block-delta', () => {
    const { mp, out } = setup()
    mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'run_shell', input: { cmd: 'ls' } })
    mp.onToolChunk({ agentId: MAIN, toolId: 't1', toolName: 'run_shell', title: '', summary: '', content: 'file1\n' })
    mp.onToolComplete({ agentId: MAIN, toolId: 't1', toolName: 'run_shell', title: '', summary: '', content: 'file1\nfile2' })
    const kinds = out.map((m) => m.type)
    expect(kinds).toEqual(['agent:turn-start', 'agent:block-start', 'agent:block-delta', 'agent:block-end'])
    expect((out[3] as any).result).toMatchObject({ ok: true, content: 'file1\nfile2' })
  })

  it('无 complete 事件的工具（todo 类）在下个 message:complete 被强制关块', () => {
    const { mp, out } = setup()
    mp.onToolStart({ agentId: MAIN, toolId: 'todo1', toolName: 'create_todo', input: { title: 'x' } })
    mp.onMessageComplete({ id: 'm2', agentId: MAIN, reasoning: '', content: '', hasToolCalls: true })
    const end = out.find((m) => m.type === 'agent:block-end' && (m as any).blockId === 'todo1') as any
    expect(end).toBeTruthy()
    expect(end.result.ok).toBe(true)
  })

  it('新迭代首个 chunk 到达时也强制关 stale tool 块', () => {
    const { mp, out } = setup()
    mp.onToolStart({ agentId: MAIN, toolId: 'todo1', toolName: 'update_todo', input: {} })
    mp.onTextChunk({ id: 'm2', delta: '下一步' })
    const idx = out.findIndex((m) => m.type === 'agent:block-end' && (m as any).blockId === 'todo1')
    const textIdx = out.findIndex((m) => m.type === 'agent:block-start' && (m as any).blockId === 'm2#text-0')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(textIdx)
  })

  it('error 无 toolId 时生成兜底 blockId，end 自带 kind/toolName 可独立渲染', () => {
    const { mp, out } = setup()
    mp.onToolError({ agentId: MAIN, toolName: 'plc_x', title: '', content: 'not found', input: {} })
    const end = out.find((m) => m.type === 'agent:block-end') as any
    expect(end.blockId).toBeTruthy()
    expect(end.kind).toBe('tool')
    expect(end.toolName).toBe('plc_x')
    expect(end.result.ok).toBe(false)
  })
})

describe('BlockMapper: agentId 过滤（子代理泄漏防护）', () => {
  it('子代理的 complete / tool 事件全部丢弃', () => {
    const { mp, out } = setup()
    mp.onToolStart({ agentId: 'task-9', toolId: 's1', toolName: 'sub_tool', input: {} })
    mp.onMessageComplete({ id: 'sub', agentId: 'task-9', reasoning: '', content: '', hasToolCalls: false })
    expect(out).toHaveLength(0) // 连 turn 都不开
  })
})

describe('BlockMapper: thinking 兜底与截断门', () => {
  it('无流式 thinking 但 complete.reasoning 非空 → 补发整块', () => {
    const { mp, out } = setup()
    mp.onTextChunk({ id: 'm1', delta: 'hi' })
    mp.onMessageComplete({ id: 'm1', agentId: MAIN, reasoning: '完整推理', content: 'hi', hasToolCalls: false })
    const fb = out.find((m) => m.type === 'agent:block-start' && (m as any).kind === 'thinking') as any
    expect(fb).toBeTruthy()
    const delta = out.find((m) => m.type === 'agent:block-delta' && (m as any).blockId === fb.blockId) as any
    expect(delta.delta).toBe('完整推理')
  })

  it('结果 >16KB 截断并标 truncated/rawBytes；input >8KB 截断；流式累计 >16KB 停止追加', () => {
    const { mp, out } = setup()
    const big = 'x'.repeat(20 * 1024)
    mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', input: { data: big } })
    const start = out.find((m) => m.type === 'agent:block-start') as any
    expect(JSON.stringify(start.input).length).toBeLessThan(9 * 1024)
    mp.onToolChunk({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', title: '', summary: '', content: big })
    mp.onToolChunk({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', title: '', summary: '', content: big })
    const deltas = out.filter((m) => m.type === 'agent:block-delta') as any[]
    const total = deltas.reduce((n, d) => n + d.delta.length, 0)
    expect(total).toBeLessThanOrEqual(16 * 1024 + 64) // +截断标注余量
    mp.onToolComplete({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', title: '', summary: '', content: big })
    const end = out.find((m) => m.type === 'agent:block-end' && (m as any).blockId === 't1') as any
    expect(end.result.truncated).toBe(true)
    expect(end.result.rawBytes).toBe(20 * 1024)
    expect(end.result.content.length).toBeLessThanOrEqual(16 * 1024)
  })
})

describe('BlockMapper: review 修复（未知 toolId / 不可序列化 input / 截断标注边界）', () => {
  it('未知 toolId 的迟到 complete（如 reset 后）不开幽灵 turn 不发 block-end', () => {
    const { mp, out } = setup()
    mp.onToolComplete({ agentId: MAIN, toolId: 'ghost', toolName: 'plc_compile', title: '', summary: '', content: 'ok' })
    expect(out).toHaveLength(0)
  })

  it('循环引用 input 不抛错，block-start 标 _unserializable，snapshot 可序列化', () => {
    const { mp, out } = setup()
    const a: any = {}
    a.self = a
    expect(() => mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'plc_x', input: a })).not.toThrow()
    const start = out.find((m) => m.type === 'agent:block-start') as any
    expect(start.input).toMatchObject({ _unserializable: true })
    expect(() => mp.snapshot()).not.toThrow()
  })

  it('流式累计恰好填满 16KB 后再丢弃 → streamText 以截断标注结尾且不再增长', () => {
    const { mp } = setup()
    const MARK = '\n…[已截断]'
    const chunk = 'x'.repeat(8 * 1024)
    mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', input: {} })
    mp.onToolChunk({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', title: '', summary: '', content: chunk })
    mp.onToolChunk({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', title: '', summary: '', content: chunk })
    mp.onToolChunk({ agentId: MAIN, toolId: 't1', toolName: 'plc_trace', title: '', summary: '', content: chunk })
    const tool = mp.snapshot()!.blocks.find((b) => b.id === 't1') as any
    expect(tool.streamText.endsWith(MARK)).toBe(true)
    expect(tool.streamText.length).toBeLessThanOrEqual(16 * 1024 + MARK.length)
  })
})

describe('BlockMapper: 快照', () => {
  it('快照镜像当前 turn 的块；turn-end 后为 null', () => {
    const { mp } = setup()
    mp.onThinkingChunk({ id: 'm1', delta: '想' })
    mp.onToolStart({ agentId: MAIN, toolId: 't1', toolName: 'plc_compile', input: {} })
    const snap = mp.snapshot()!
    expect(snap.blocks.map((b) => b.kind)).toEqual(['thinking', 'tool'])
    expect((snap.blocks[0] as any).text).toBe('想')
    mp.onMessageComplete({ id: 'm1', agentId: MAIN, reasoning: '', content: '', hasToolCalls: false })
    expect(mp.snapshot()).toBeNull()
  })
})
