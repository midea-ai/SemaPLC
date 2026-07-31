import { create } from 'zustand'
import type { WsClientLike } from '../ws/client'

export interface LogEntry {
  id: number               // monotonic, assigned by the store — stable identity for UI keys/expansion
  ts: number
  source: 'iec2c' | 'gcc' | 'runtime' | 'tool' | 'agent' | 'system'
  level: 'info' | 'warn' | 'error'
  message: string
  // Tool-call metadata (only present when source === 'tool')
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  duration?: number        // ms
  isToolError?: boolean
}

const MAX_LOGS = 500
const MAX_TOOL_RESULT_SIZE = 10_000 // 10KB — truncate large tool results

// Buffer tool-start events until the matching tool-complete arrives,
// then merge into a single LogEntry with input + output + duration.
const pendingTools = new Map<string, { name: string; input: unknown; startTs: number }>()

function truncateResult(result: unknown): unknown {
  try {
    const s = JSON.stringify(result)
    if (s.length <= MAX_TOOL_RESULT_SIZE) return result
    return s.slice(0, MAX_TOOL_RESULT_SIZE) + '…(truncated)'
  } catch {
    return String(result).slice(0, MAX_TOOL_RESULT_SIZE)
  }
}

interface LogsStore {
  entries: LogEntry[]
  append: (e: Omit<LogEntry, 'id'>) => void
  clear: () => void
}

let nextLogId = 1

export const useLogsStore = create<LogsStore>((set) => ({
  entries: [],
  append: (e) => set((s) => ({ entries: [...s.entries.slice(-(MAX_LOGS - 1)), { ...e, id: nextLogId++ }] })),
  clear: () => { pendingTools.clear(); set({ entries: [] }) },
}))

function append(source: LogEntry['source'], level: LogEntry['level'], message: string, ts = Date.now()) {
  useLogsStore.getState().append({ ts, source, level, message })
}

// Tool names from MCP have the form 'mcp__<server>__<tool>'. Strip the prefix for log brevity.
function shortToolName(raw: string): string {
  const m = raw.match(/^mcp__[^_]+__(.+)$/)
  return m ? m[1] : raw
}

// Unwrap MCP tool result into a plain object. MCP returns
// { content: [{ type: 'text', text: '...json or text...' }] } most of the time,
// but some adapters pass through the raw string or already-parsed object.
function unwrapToolResult(result: unknown): any {
  if (result == null) return null
  let r: any = result
  if (typeof r === 'object' && Array.isArray(r.content)) {
    const text = r.content.find((c: any) => c?.type === 'text')?.text
    if (typeof text === 'string') r = text
  }
  if (typeof r === 'string') {
    try { return JSON.parse(r) } catch { return r }
  }
  return r
}

// Expand a failed tool result into multiple readable log lines so the user can
// see WHY it failed (matiec/gcc errors, agentSummary), not just a one-line
// "compile failed". Returns one or more lines to append to the log panel.
function extractFailureLines(result: unknown): string[] {
  const obj = unwrapToolResult(result)
  if (obj == null) return ['unknown error']
  if (typeof obj === 'string') return [obj.length > 500 ? obj.slice(0, 500) + '…' : obj]
  if (typeof obj !== 'object') return [String(obj)]

  const lines: string[] = []
  if (obj.failedStage) lines.push(`stage: ${obj.failedStage}`)
  if (obj.agentSummary) lines.push(String(obj.agentSummary))

  // matiec (iec2c) compile errors
  const iec2cErrors = obj.compile?.iec2c?.errors ?? []
  for (const e of iec2cErrors.slice(0, 20)) {
    const msg = typeof e === 'string' ? e : (e.message ?? JSON.stringify(e))
    const loc = e && e.line != null ? ` (line ${e.line})` : ''
    lines.push(`  iec2c: ${msg}${loc}`)
  }
  // gcc / upload errors
  if (obj.upload?.uploadError) lines.push(`  upload: ${obj.upload.uploadError}`)
  for (const e of (obj.upload?.gccErrors ?? []).slice(0, 20)) lines.push(`  gcc: ${String(e)}`)

  // generic fallbacks if nothing structured was found
  if (lines.length === 0) {
    const fallback = obj.errorMessage ?? obj.error ?? obj.message ?? obj.stderr ?? obj.stdout
    if (fallback) lines.push(String(fallback).slice(0, 500))
    else lines.push(JSON.stringify(obj).slice(0, 500))
  }
  return lines
}

export function subscribeLogsToWs(client: WsClientLike) {
  client.on((m) => {
    switch (m.type) {
      case 'log':
        useLogsStore.getState().append({ ts: m.ts, source: m.source, level: m.level, message: m.message })
        break
      case 'workspace:switching':
        useLogsStore.getState().clear()
        break
      case 'workspace:ready':
        append('system', 'info', `workspace ready: ${m.path}`)
        break
      case 'error':
        append('system', 'error', m.message)
        break
      case 'plc:runtime-error':
        for (const e of m.errors) {
          const line = e.line ? ` (line ${e.line})` : ''
          append('runtime', 'error', `[${e.type}]${line} ${e.message} — advice: ${e.advice}`)
        }
        break
      case 'agent:tool-start': {
        pendingTools.set(m.toolId, { name: shortToolName(m.name), input: m.input, startTs: Date.now() })
        break
      }
      case 'agent:tool-complete': {
        const name = shortToolName(m.name)
        const pending = pendingTools.get(m.toolId)
        pendingTools.delete(m.toolId)
        // duration is only known when a matching tool-start was seen (plc-controller
        // manual path) — sema-core emits no start event for agent-driven calls.
        const duration = pending ? Date.now() - pending.startTs : undefined
        const durationStr = duration != null ? ` (${duration}ms)` : ''
        const output = unwrapToolResult(m.result)
        // Input fallback chain: raw input from start pairing > raw input on error
        // frames > sema-core's formatted input summary (title).
        const toolInput = pending?.input ?? m.input ?? m.title

        if (m.isError) {
          const failureLines = extractFailureLines(m.result)
          useLogsStore.getState().append({
            ts: Date.now(), source: 'tool', level: 'error',
            message: `✗ ${name}${durationStr}: ${failureLines[0]}`,
            toolName: name,
            toolInput,
            toolOutput: truncateResult(output),
            duration,
            isToolError: true,
          })
          // Extra failure detail lines (matiec/gcc errors) — plain entries, no tool metadata
          for (const extra of failureLines.slice(1)) append('tool', 'error', extra)
        } else {
          useLogsStore.getState().append({
            ts: Date.now(), source: 'tool', level: 'info',
            message: `✓ ${name}${durationStr}`,
            toolName: name,
            toolInput,
            toolOutput: truncateResult(output),
            duration,
            isToolError: false,
          })
        }
        break
      }
      case 'agent:block-start': {
        if (m.kind === 'tool') pendingTools.set(m.blockId, { name: shortToolName(m.toolName ?? ''), input: m.input, startTs: Date.now() })
        break
      }
      case 'agent:block-end': {
        if (m.kind !== 'tool') break
        const name = shortToolName(m.toolName ?? '')
        const pending = pendingTools.get(m.blockId)
        pendingTools.delete(m.blockId)
        const duration = pending ? Date.now() - pending.startTs : undefined
        const durationStr = duration != null ? ` (${duration}ms)` : ''
        const ok = m.result?.ok !== false
        const output = m.result?.content ?? ''
        if (!ok) {
          useLogsStore.getState().append({
            ts: Date.now(), source: 'tool', level: 'error',
            message: `✗ ${name}${durationStr}: ${output.split('\n')[0]?.slice(0, 200) ?? ''}`,
            toolName: name, toolInput: pending?.input, toolOutput: truncateResult(output),
            duration, isToolError: true,
          })
        } else if (output !== '') {  // 强制关块的空结果（todo 类）不刷一条空日志
          useLogsStore.getState().append({
            ts: Date.now(), source: 'tool', level: 'info',
            message: `✓ ${name}${durationStr}`,
            toolName: name, toolInput: pending?.input, toolOutput: truncateResult(output),
            duration, isToolError: false,
          })
        }
        break
      }
      case 'agent:user-input-received':
        append('agent', 'info', `user: ${m.text.length > 120 ? m.text.slice(0, 120) + '…' : m.text}`)
        break
      case 'agent:state':
        if (m.state === 'idle') pendingTools.clear()
        break
      case 'plc:state':
        append('system', 'info', `PLC state → ${m.status}`)
        break
    }
  })
}
