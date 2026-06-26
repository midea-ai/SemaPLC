import { randomBytes } from 'crypto'
import type { ServerMessage, AgentBlock, SerializedTurn, ToolBlockResult } from '../shared/protocol.js'

// sema-core src/manager/StateManager.ts:46 `export const MAIN_AGENT_ID = 'main'`
// （未从包入口导出，这里硬编码）。子代理(task-*)的 complete/tool 事件会从同一
// session 总线泄漏（disableChunkEvents 只挡 chunk）——不过滤会把主 turn 提前封口。
const MAIN_AGENT_ID = 'main'

// 三道显示门（仅显示链路；agent 拿到的工具结果不受影响）
const RESULT_CAP = 16 * 1024   // tool complete/error content
const STREAM_CAP = 16 * 1024   // tool chunk 累计
const INPUT_CAP = 8 * 1024     // block-start input（stCode/scene spec 可达几十 KB）

const TRUNC_MARK = '\n…[已截断]'

function asString(c: unknown): string {
  if (typeof c === 'string') return c
  try { return JSON.stringify(c, null, 2) } catch { return String(c) }
}
function capResult(content: unknown): { content: string; truncated?: boolean; rawBytes?: number } {
  const s = asString(content)
  if (s.length <= RESULT_CAP) return { content: s }
  return { content: s.slice(0, RESULT_CAP - TRUNC_MARK.length) + TRUNC_MARK, truncated: true, rawBytes: s.length }
}
function capInput(input: unknown): unknown {
  let s: string | null = null
  try { s = JSON.stringify(input) ?? '' } catch { /* 循环引用等不可序列化 */ }
  if (s === null) return { _unserializable: true, preview: String(input) }
  if (s.length <= INPUT_CAP) return input
  return { _truncated: true, _rawBytes: s.length, preview: s.slice(0, INPUT_CAP) }
}

interface OpenStream { blockId: string; msgId: string; firstTs: number; lastTs: number }

/**
 * sema-core 事件 → agent 块协议 的纯状态机。
 * 不做 IO：事件经构造注入的 emit 回调发出；时钟可注入（测试用）。
 * turn 懒开启；封口仅由 message:complete(hasToolCalls=false) / idle / interrupted 触发；
 * session:error 不进这里（bridge 保留既有 'error' 直发，非终态——spec H3）。
 */
export class BlockMapper {
  private turnId: string | null = null
  private turnSeq = 0
  private mirror: AgentBlock[] = []
  private openThinking: OpenStream | null = null
  private openText: OpenStream | null = null
  private openTools = new Map<string, { toolName: string }>()
  private counters = new Map<string, { thinking: number; text: number }>()
  private thinkingSeen = new Set<string>()  // 发过流式 thinking 的 msgId（兜底判据）
  private lastMsgId: string | null = null

  constructor(private emitFn: (m: ServerMessage) => void, private now: () => number = Date.now) {}

  // ── 内部 ──
  private emit(m: ServerMessage) { this.emitFn(m) }
  private ensureTurn(): string {
    if (!this.turnId) {
      this.turnId = `turn-${++this.turnSeq}-${this.now()}`
      this.mirror = []
      this.emit({ type: 'agent:turn-start', turnId: this.turnId })
    }
    return this.turnId
  }
  private counter(msgId: string) {
    let c = this.counters.get(msgId)
    if (!c) { c = { thinking: 0, text: 0 }; this.counters.set(msgId, c) }
    return c
  }
  private findMirror(blockId: string): AgentBlock | undefined {
    return this.mirror.find((b) => b.id === blockId)
  }
  /** 新迭代开始（新 msgId 的首个 chunk）→ 上一迭代无 complete 事件的工具强制关块 */
  private onNewMsg(msgId: string) {
    if (this.lastMsgId !== msgId) {
      this.lastMsgId = msgId
      this.forceCloseTools()
    }
  }
  private forceCloseTools() {
    for (const [toolId, t] of this.openTools) {
      this.closeTool(toolId, t.toolName, { ok: true, content: '' })
    }
  }
  private closeTool(toolId: string, toolName: string, result: ToolBlockResult) {
    const turnId = this.ensureTurn()
    this.openTools.delete(toolId)
    const b = this.findMirror(toolId)
    if (b && b.kind === 'tool') { b.status = result.ok ? 'success' : 'error'; b.result = result }
    this.emit({ type: 'agent:block-end', turnId, blockId: toolId, kind: 'tool', toolName, result })
  }
  private closeThinking() {
    if (!this.openThinking) return
    const { blockId, firstTs, lastTs } = this.openThinking
    const durationMs = lastTs - firstTs
    const b = this.findMirror(blockId)
    if (b && b.kind === 'thinking') { b.streaming = false; b.durationMs = durationMs }
    this.emit({ type: 'agent:block-end', turnId: this.turnId!, blockId, kind: 'thinking', durationMs })
    this.openThinking = null
  }
  private closeText() {
    if (!this.openText) return
    const b = this.findMirror(this.openText.blockId)
    if (b && b.kind === 'text') b.streaming = false
    this.emit({ type: 'agent:block-end', turnId: this.turnId!, blockId: this.openText.blockId, kind: 'text' })
    this.openText = null
  }

  // ── sema-core 事件入口 ──
  onThinkingChunk(d: { id: string; delta: string }) {
    const turnId = this.ensureTurn()
    this.onNewMsg(d.id)
    this.thinkingSeen.add(d.id)
    // interleaved（同消息 thinking→text→thinking）：text 开着说明本段是第二波 → 先关 text 开新 thinking
    if (this.openText?.msgId === d.id) this.closeText()
    if (this.openThinking && this.openThinking.msgId !== d.id) this.closeThinking()
    if (!this.openThinking) {
      const n = this.counter(d.id).thinking++
      const blockId = `${d.id}#thinking-${n}`
      this.openThinking = { blockId, msgId: d.id, firstTs: this.now(), lastTs: this.now() }
      this.mirror.push({ kind: 'thinking', id: blockId, text: '', streaming: true })
      this.emit({ type: 'agent:block-start', turnId, blockId, kind: 'thinking' })
    }
    this.openThinking.lastTs = this.now()
    const b = this.findMirror(this.openThinking.blockId)
    if (b && b.kind === 'thinking') b.text += d.delta
    this.emit({ type: 'agent:block-delta', turnId, blockId: this.openThinking.blockId, delta: d.delta })
  }

  onTextChunk(d: { id: string; delta: string }) {
    const turnId = this.ensureTurn()
    this.onNewMsg(d.id)
    this.closeThinking()
    if (this.openText && this.openText.msgId !== d.id) this.closeText()
    if (!this.openText) {
      const n = this.counter(d.id).text++
      const blockId = `${d.id}#text-${n}`
      this.openText = { blockId, msgId: d.id, firstTs: this.now(), lastTs: this.now() }
      this.mirror.push({ kind: 'text', id: blockId, text: '', streaming: true })
      this.emit({ type: 'agent:block-start', turnId, blockId, kind: 'text' })
    }
    const b = this.findMirror(this.openText.blockId)
    if (b && b.kind === 'text') b.text += d.delta
    this.emit({ type: 'agent:block-delta', turnId, blockId: this.openText.blockId, delta: d.delta })
  }

  onToolStart(d: { agentId: string; toolId: string; toolName: string; input: Record<string, unknown> }) {
    if (d.agentId !== MAIN_AGENT_ID) return
    const turnId = this.ensureTurn()
    const input = capInput(d.input)
    this.openTools.set(d.toolId, { toolName: d.toolName })
    this.mirror.push({ kind: 'tool', id: d.toolId, toolName: d.toolName, input, status: 'running' })
    this.emit({ type: 'agent:block-start', turnId, blockId: d.toolId, kind: 'tool', toolName: d.toolName, input })
  }

  onToolChunk(d: { agentId: string; toolId: string; toolName: string; content: unknown }) {
    if (d.agentId !== MAIN_AGENT_ID) return
    if (!this.openTools.has(d.toolId)) return
    const turnId = this.ensureTurn()
    const b = this.findMirror(d.toolId)
    if (!b || b.kind !== 'tool') return
    const cur = b.streamText ?? ''
    if (cur.length >= STREAM_CAP) return  // 累计门：已满则丢弃（含已附截断标注）
    let delta = asString(d.content)
    // >=：恰好填满也走截断路径附标注，保证"发生过丢弃 ⇒ streamText 必以 TRUNC_MARK 结尾"
    if (cur.length + delta.length >= STREAM_CAP) delta = delta.slice(0, STREAM_CAP - cur.length) + TRUNC_MARK
    b.streamText = cur + delta
    this.emit({ type: 'agent:block-delta', turnId, blockId: d.toolId, delta })
  }

  onToolComplete(d: { agentId: string; toolId: string; toolName: string; content: unknown }) {
    if (d.agentId !== MAIN_AGENT_ID) return
    // 未知 toolId（典型：工具运行中 session-reset，mapper 已重置，迟到的 complete）→ 丢弃，
    // 否则会发出从未 start 的 block-end 并开出空"幽灵 turn"
    if (!this.openTools.has(d.toolId) && !this.findMirror(d.toolId)) return
    this.ensureTurn()
    const r = capResult(d.content)
    this.closeTool(d.toolId, d.toolName, { ok: true, ...r })
  }

  onToolError(d: { agentId: string; toolId?: string; toolName: string; content: unknown }) {
    if (d.agentId !== MAIN_AGENT_ID) return
    this.ensureTurn()
    const toolId = d.toolId ?? `toolerr-${this.now()}-${randomBytes(2).toString('hex')}`
    // start 缺失（不应发生——start 在 runToolUse 入口；防御中途接入）：mirror 补一个块
    if (!this.findMirror(toolId)) {
      this.mirror.push({ kind: 'tool', id: toolId, toolName: d.toolName, status: 'running' })
      this.openTools.set(toolId, { toolName: d.toolName })
    }
    const r = capResult(d.content)
    this.closeTool(toolId, d.toolName, { ok: false, ...r })
  }

  onMessageComplete(d: { id: string; agentId: string; reasoning: string; content: string; hasToolCalls: boolean }) {
    if (d.agentId !== MAIN_AGENT_ID) return
    const turnId = this.ensureTurn()
    // 关本迭代的流式块
    if (this.openThinking) this.closeThinking()
    if (this.openText) this.closeText()
    // H2：无 genToolResultMessage 的工具（todo 类）成功时不发 complete → 强制关块
    this.forceCloseTools()
    // thinking 兜底：provider 不发流式 thinking 但 complete.reasoning 有完整内容
    if (d.reasoning && !this.thinkingSeen.has(d.id)) {
      const blockId = `${d.id}#thinking-fb`
      this.mirror.push({ kind: 'thinking', id: blockId, text: d.reasoning, streaming: false })
      this.emit({ type: 'agent:block-start', turnId, blockId, kind: 'thinking' })
      this.emit({ type: 'agent:block-delta', turnId, blockId, delta: d.reasoning })
      this.emit({ type: 'agent:block-end', turnId, blockId, kind: 'thinking' })
    }
    if (!d.hasToolCalls) this.endTurn('done')
  }

  onIdle() { if (this.turnId) { this.closeAllOpen(false); this.endTurn('done') } }
  onInterrupted() { if (this.turnId) { this.closeAllOpen(true); this.endTurn('interrupted') } }

  private closeAllOpen(asInterrupted: boolean) {
    this.closeThinking()
    this.closeText()
    for (const [toolId, t] of this.openTools) {
      this.closeTool(toolId, t.toolName, asInterrupted ? { ok: false, content: '已中断' } : { ok: true, content: '' })
    }
  }
  private endTurn(status: 'done' | 'error' | 'interrupted') {
    if (!this.turnId) return
    this.emit({ type: 'agent:turn-end', turnId: this.turnId, status })
    this.turnId = null
    this.mirror = []
    this.openThinking = null
    this.openText = null
    this.openTools.clear()
    this.counters.clear()
    this.thinkingSeen.clear()
    this.lastMsgId = null
  }

  /** 当前 turn 的块镜像（深拷贝）；无开放 turn 时 null。新客户端连接时重放用。 */
  snapshot(): SerializedTurn | null {
    if (!this.turnId) return null
    return { turnId: this.turnId, blocks: JSON.parse(JSON.stringify(this.mirror)) }
  }
  reset() { this.endTurn('done') }
}
