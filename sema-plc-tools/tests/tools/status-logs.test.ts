import { describe, it, expect, vi } from 'vitest'
import { handleStatus } from '../../src/tools/status.js'
import { handleGetLogs } from '../../src/tools/getLogs.js'
import { parseRuntimeLogs } from '../../src/tools/runtimeLogParser.js'

describe('handleStatus', () => {
  it('returns status with isRunning=true when RUNNING', async () => {
    const client = { getStatus: vi.fn().mockResolvedValue('RUNNING') }
    const result = await handleStatus(client as any)
    expect(result.status).toBe('RUNNING')
    expect(result.isRunning).toBe(true)
    expect(result.runtimeReachable).toBe(true)
  })

  it('returns runtimeReachable=false on connection error', async () => {
    const client = { getStatus: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) }
    const result = await handleStatus(client as any)
    expect(result.runtimeReachable).toBe(false)
    expect(result.isRunning).toBe(false)
  })
})

describe('handleGetLogs', () => {
  it('returns structured log result with empty runtimeErrors on clean log', async () => {
    const logs = 'INFO: cycle 1\nINFO: cycle 2'
    const client = { getRuntimeLogs: vi.fn().mockResolvedValue(logs) }
    const result = await handleGetLogs({ lines: 10 }, client as any)
    expect(result.hasRuntimeErrors).toBe(false)
    expect(result.runtimeErrors).toEqual([])
    expect(result.lastLine).toBe('INFO: cycle 2')
    expect(result.lineCount).toBe(2)
  })

  it('populates runtimeErrors when log has known pattern', async () => {
    const logs = 'INFO: cycle 1\nERROR: Watchdog timer expired\nINFO: stopped'
    const client = { getRuntimeLogs: vi.fn().mockResolvedValue(logs) }
    const result = await handleGetLogs({ lines: 10 }, client as any)
    expect(result.hasRuntimeErrors).toBe(true)
    expect(result.runtimeErrors).toHaveLength(1)
    expect(result.runtimeErrors[0].type).toBe('watchdog')
  })

  it('hasRuntimeErrors is derived from runtimeErrors.length, not substring match', async () => {
    // "error" substring exists but no known pattern → should NOT report runtime error
    const logs = 'INFO: previous error condition cleared'
    const client = { getRuntimeLogs: vi.fn().mockResolvedValue(logs) }
    const result = await handleGetLogs({ lines: 10 }, client as any)
    expect(result.hasRuntimeErrors).toBe(false)
    expect(result.runtimeErrors).toEqual([])
  })

  it('parses OpenPLC /api/runtime-logs JSON shape and slices entries (regression for 113 KB single-line bloat)', async () => {
    // Real OpenPLC returns {"runtime-logs":[{id,level,message,timestamp},...]} on a single line.
    // The old implementation split by \n → 1 line → slice(-50) was a no-op → entire 100KB+ blob
    // sent to the LLM and ate 95% of the context window. Verify we parse the array.
    const entries = Array.from({ length: 200 }, (_, i) => ({
      id: i,
      level: 'INFO',
      message: `Debug WebSocket connected for user ${i}`,
      timestamp: '2026-05-21T09:26:26+0000',
    }))
    const rawJsonSingleLine = JSON.stringify({ 'runtime-logs': entries })
    const client = { getRuntimeLogs: vi.fn().mockResolvedValue(rawJsonSingleLine) }
    const result = await handleGetLogs({ lines: 10 }, client as any)
    // We asked for 10 lines, must have at most 10 (could be fewer if size cap triggered)
    expect(result.lineCount).toBeLessThanOrEqual(10)
    // Output must be much smaller than input
    expect(result.logs.length).toBeLessThan(rawJsonSingleLine.length / 10)
    // Last entry must be present (most recent slice)
    expect(result.logs).toContain('user 199')
    // Format should be readable
    expect(result.logs).toContain('[INFO]')
  })

  it('hard-caps output at 8KB even when the requested line count would exceed it', async () => {
    // Each entry's "message" is ~200 chars × 500 entries = 100KB if we kept all of them
    const entries = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      level: 'INFO',
      message: 'x'.repeat(200) + ` index=${i}`,
      timestamp: '2026-05-21T00:00:00+0000',
    }))
    const rawJsonSingleLine = JSON.stringify({ 'runtime-logs': entries })
    const client = { getRuntimeLogs: vi.fn().mockResolvedValue(rawJsonSingleLine) }
    const result = await handleGetLogs({ lines: 500 }, client as any)
    // Capped to 8 KB (+ short prefix line)
    expect(Buffer.byteLength(result.logs, 'utf8')).toBeLessThan(8400)
    // Newest entries preserved (truncation drops from the head)
    expect(result.logs).toContain('index=499')
    // Truncation marker present
    expect(result.logs).toMatch(/older entries truncated/)
  })

  it('falls back to newline-delimited path for non-JSON plain-text logs (back-compat)', async () => {
    const plain = 'line A\nline B\nline C'
    const client = { getRuntimeLogs: vi.fn().mockResolvedValue(plain) }
    const result = await handleGetLogs({ lines: 10 }, client as any)
    expect(result.logs).toBe('line A\nline B\nline C')
    expect(result.lineCount).toBe(3)
  })
})

describe('parseRuntimeLogs', () => {
  it('detects watchdog timeout', () => {
    const log = [
      'INFO: cycle 100',
      'ERROR: Watchdog timer expired at scan #101',
      'INFO: PLC stopped',
    ].join('\n')
    const errors = parseRuntimeLogs(log)
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('watchdog')
    expect(errors[0].message).toContain('Watchdog timer expired')
    expect(errors[0].line).toBe(2)
    expect(errors[0].advice).toMatch(/scan/i)
  })

  it('returns empty array on clean log', () => {
    const log = 'INFO: cycle 1\nINFO: cycle 2'
    expect(parseRuntimeLogs(log)).toEqual([])
  })

  it('returns empty array on empty input', () => {
    expect(parseRuntimeLogs('')).toEqual([])
  })

  it('detects scan overrun', () => {
    const errors = parseRuntimeLogs('WARN: Scan time overflow detected, 25ms > 20ms task interval')
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('scan_overrun')
    expect(errors[0].advice).toMatch(/scan/i)
  })

  it('detects segfault', () => {
    const errors = parseRuntimeLogs('FATAL: Segmentation fault in OpenPLC_Cycle')
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('segfault')
  })

  it('detects division by zero', () => {
    const errors = parseRuntimeLogs('ERROR: division by zero in expression X / Y at line 12')
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('div_by_zero')
  })

  it('handles SIGSEGV variant', () => {
    const errors = parseRuntimeLogs('Received SIGSEGV, terminating')
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('segfault')
  })

  it('detects multiple distinct errors and preserves order', () => {
    const log = [
      'INFO: cycle 1',
      'ERROR: Watchdog timer fired',
      'INFO: restart attempted',
      'FATAL: Segmentation fault',
    ].join('\n')
    const errors = parseRuntimeLogs(log)
    expect(errors).toHaveLength(2)
    expect(errors[0].type).toBe('watchdog')
    expect(errors[0].line).toBe(2)
    expect(errors[1].type).toBe('segfault')
    expect(errors[1].line).toBe(4)
  })

  it('ignores lines containing the word "error" without a known pattern', () => {
    expect(parseRuntimeLogs('INFO: previous error already cleared, OK')).toEqual([])
  })

  it('detects scan_overrun literal token', () => {
    const errors = parseRuntimeLogs('ERROR: scan_overrun at cycle 55')
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('scan_overrun')
  })
})
