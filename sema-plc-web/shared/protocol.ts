// Shared WS protocol — imported by both frontend (src/) and backend (server/).
// Includes all P1 messages + P2 reserved slots (no behavior change for P1 clients on receiving reserved msgs).

export type PlcStatus = 'EMPTY' | 'INIT' | 'RUNNING' | 'STOPPED' | 'ERROR'
export type LogSource = 'iec2c' | 'gcc' | 'runtime' | 'tool' | 'agent' | 'system'
export type LogLevel = 'info' | 'warn' | 'error'

export interface VariableEntry {
  index: number
  name: string
  type: string
  location: string
}

export interface VariableValue {
  value: number | boolean | string
  type: string
  index: number
  location: string
}

export interface RuntimeError {
  type: 'watchdog' | 'scan_overrun' | 'segfault' | 'div_by_zero' | 'array_oob' | 'unknown'
  message: string
  line?: number
  advice: string
}

// Agent todo (mirrors sema-core src/types/todoTask.ts TodoItem — UI 推送用精简型)
export interface TodoItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  progressText?: string
}

// ── Agent 块协议（结构化聊天渲染）——一个 turn 一条 assistant 消息，
// 内部按真实顺序交错 thinking / text / tool 三类块。见 specs/2026-06-11 设计文档。
export interface ToolBlockResult {
  ok: boolean
  content: string
  truncated?: boolean   // bridge 16KB 显示门截断（agent 拿到的工具结果不受影响）
  rawBytes?: number     // 截断前原始字节数
}
export type AgentBlock =
  | { kind: 'thinking'; id: string; text: string; durationMs?: number; streaming: boolean }
  | { kind: 'text'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; toolName: string; input?: unknown; streamText?: string;
      result?: ToolBlockResult; status: 'running' | 'success' | 'error' }
export interface SerializedTurn { turnId: string; blocks: AgentBlock[] }

// ── Scene Spec (process simulation) — mirrors plc-tools src/tools/sceneSpec.ts ──
export type ValueMatch =
  | { eq: number | boolean }
  | { gte: number; lt?: number }
  | { truthy: true }

export interface TranslateAlongEffect {
  type: 'translateAlong'
  host: string
  axis?: 'x' | 'y'
  variable: string
  valueFrom: number
  valueTo: number
}
export interface SnapTo { to: string; dx: number; dy: number }

export type Effect =
  | { type: 'fill'; map: { when: ValueMatch; color: string }[] }
  | { type: 'visible'; when: ValueMatch }
  | { type: 'text'; format?: string; decimals?: number; suffix?: string }
  | { type: 'translateX'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'translateY'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'width'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'height'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'opacity'; valueFrom: number; valueTo: number; from: number; to: number }
  | { type: 'rotate'; degPerUnit?: number }
  | { type: 'class'; map: { when: ValueMatch; className: string }[] }
  | TranslateAlongEffect

export interface Binding { variable: string; target?: string; effect: Effect }
export interface PartInstance {
  id: string; kind: string; x: number; y: number
  w?: number; h?: number; rotation?: number; label?: string
  params?: Record<string, unknown>; svg?: string; snap?: SnapTo; bindings: Binding[]
}
export interface SceneSpec {
  version: '1' | '2'
  canvas: { width: number; height: number; background?: string }
  parts: PartInstance[]
}

// ─────────────────────────── Client → Server ───────────────────────────
export type ClientMessage =
  | { type: 'user:input'; text: string }
  | { type: 'plc:run'; stCode: string }
  | { type: 'plc:stop' }
  | { type: 'plc:read'; names?: string[] }                                       // P2
  | { type: 'plc:fetch-logs'; lines?: number }
  | { type: 'workspace:switch'; path: string }
  | { type: 'agent:interrupt' }
  | { type: 'editor:open'; path: string }                                        // P2 (client switching file)
  | { type: 'editor:save'; path?: string; stCode: string }
  // Force / release variable signals (input simulation). set maps name→value;
  // release lists names to un-force. The user typically sends one at a time.
  | { type: 'plc:force'; set?: Record<string, number | boolean>; release?: string[] }
  | { type: 'permission:response'; requestId: string; decision: 'allow' | 'deny' | 'allow-always' }  // P2 reserved
  | { type: 'session:reset' }

// ─────────────────────────── Server → Client ───────────────────────────
export type ServerMessage =
  // workspace lifecycle
  | { type: 'workspace:ready'; path: string; sessionId: string }
  | { type: 'workspace:switching' }
  | { type: 'workspace:error'; message: string }
  // editor (ST files)
  | { type: 'editor:files'; files: Array<{ path: string; mtime: number }> }
  | { type: 'editor:open'; path: string; content: string }
  | { type: 'editor:saved'; path: string; content?: string }
  // agent (sema-core translated)
  | { type: 'agent:user-input-received'; text: string }
  | { type: 'agent:state'; state: 'idle' | 'processing' }
  // 手动运行（plc-controller Run/Stop/Force）专用——agent 驱动的工具调用走 agent:block-* 块协议
  | { type: 'agent:tool-start'; toolId: string; name: string; input: unknown }
  | { type: 'agent:tool-complete'; toolId: string; name: string; result: unknown; isError: boolean; title?: string; input?: unknown }
  | { type: 'agent:todos'; todos: TodoItem[] }
  // agent 块协议（结构化渲染）。所有块事件带 turnId——中途加入的客户端要能懒建 turn 容器。
  | { type: 'agent:turn-start'; turnId: string }
  | { type: 'agent:block-start'; turnId: string; blockId: string; kind: 'thinking' | 'text' | 'tool'; toolName?: string; input?: unknown }
  | { type: 'agent:block-delta'; turnId: string; blockId: string; delta: string }
  | { type: 'agent:block-end'; turnId: string; blockId: string; kind: 'thinking' | 'text' | 'tool'; toolName?: string; durationMs?: number; result?: ToolBlockResult }
  | { type: 'agent:turn-end'; turnId: string; status: 'done' | 'error' | 'interrupted' }
  // 当前 turn 快照——新客户端连接时由 bridge 应答广播（不进 sticky，见 ws-gateway/sema-bridge）
  | { type: 'agent:turn-snapshot'; turn: SerializedTurn | null }
  // plc
  | { type: 'plc:state'; status: PlcStatus }
  | { type: 'plc:variables'; map: VariableEntry[] }
  | { type: 'plc:values'; values: Record<string, VariableValue> }
  | { type: 'plc:runtime-error'; errors: RuntimeError[] }
  | { type: 'plc:force-result'; forced: string[]; released: string[]; failed: Array<{ name: string; reason: string }>; error: string | null }
  | { type: 'scene:ready'; scene: SceneSpec; sceneErrors?: string[]; sceneWarnings?: string[] }
  // logs / error
  | { type: 'log'; source: LogSource; level: LogLevel; message: string; ts: number }
  | { type: 'error'; message: string }
  // P2 reserved
  | { type: 'permission:request'; requestId: string; toolName: string; input: unknown }

// Type guards
export function isClientMessage(x: unknown): x is ClientMessage {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string'
}
export function isServerMessage(x: unknown): x is ServerMessage {
  return typeof x === 'object' && x !== null && typeof (x as { type?: unknown }).type === 'string'
}
