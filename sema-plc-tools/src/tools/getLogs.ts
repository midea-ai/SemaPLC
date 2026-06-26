import { RuntimeClient } from '../client/runtime.js'
import { parseRuntimeLogs } from './runtimeLogParser.js'
import type { LogsResult } from '../types.js'

interface OpenPlcLogEntry {
  id?: number
  level?: string
  message?: string
  timestamp?: string
}

// Hard ceiling on the formatted output we hand back to the LLM. The raw
// /api/runtime-logs response can easily exceed 100 KB (OpenPLC keeps thousands
// of "Debug WebSocket connected/disconnected" entries) and dropping that into
// the conversation eats most of DeepSeek's 64 k context in a single tool result,
// which then forces sema-core's auto-compression and produces user-visible hangs.
const MAX_OUTPUT_BYTES = 8000

function formatJsonEntries(entries: OpenPlcLogEntry[], n: number): string {
  const slice = entries.slice(-n)
  return slice
    .map((e) => {
      const ts = e.timestamp ?? ''
      const level = (e.level ?? '').toUpperCase()
      const msg = e.message ?? ''
      return `[${ts}] [${level}] ${msg}`.trim()
    })
    .join('\n')
}

function truncateToBytes(s: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return { text: s, truncated: false }
  // Drop from the head — newest logs at the end matter more
  const lines = s.split('\n')
  while (lines.length > 1 && Buffer.byteLength(lines.join('\n'), 'utf8') > maxBytes) {
    lines.shift()
  }
  return { text: lines.join('\n'), truncated: true }
}

export async function handleGetLogs(
  input: { lines?: number },
  client: RuntimeClient,
): Promise<LogsResult> {
  const raw = await client.getRuntimeLogs()
  const n = input.lines ?? 50

  // OpenPLC returns one of two shapes:
  //   1. A JSON blob like `{"runtime-logs":[{id,level,message,timestamp}, ...]}` — single line, no \n
  //   2. Plain text (older builds), one entry per line
  // The previous implementation only handled (2). For (1), splitting by \n
  // produced ONE giant "line" of 100+ KB and the slice was a no-op.
  let formatted: string
  let totalEntries: number
  try {
    const parsed = JSON.parse(raw)
    const entries = (parsed && Array.isArray(parsed['runtime-logs']))
      ? (parsed['runtime-logs'] as OpenPlcLogEntry[])
      : null
    if (entries) {
      totalEntries = entries.length
      formatted = formatJsonEntries(entries, n)
    } else {
      // Unknown JSON shape — fall back to whatever-stringify
      const fallback = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)
      const ls = fallback.split('\n').filter(l => l.trim())
      totalEntries = ls.length
      formatted = ls.slice(-n).join('\n')
    }
  } catch {
    // Not JSON — assume newline-delimited plain text
    const ls = raw.split('\n').filter(l => l.trim())
    totalEntries = ls.length
    formatted = ls.slice(-n).join('\n')
  }

  // Hard size cap regardless of n — protects against very long single lines
  // (e.g. a compile error spanning thousands of characters).
  const { text, truncated } = truncateToBytes(formatted, MAX_OUTPUT_BYTES)
  const logs = truncated
    ? `[…${totalEntries - text.split('\n').length} older entries truncated to fit ${MAX_OUTPUT_BYTES} B]\n${text}`
    : text

  const runtimeErrors = parseRuntimeLogs(logs)
  const finalLines = logs.split('\n').filter(l => l.trim())

  return {
    logs,
    lineCount: finalLines.length,
    hasRuntimeErrors: runtimeErrors.length > 0,
    runtimeErrors,
    lastLine: finalLines[finalLines.length - 1] ?? '',
  }
}
