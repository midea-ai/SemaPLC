import { describe, it, expect, vi } from 'vitest'
import { handleStart } from '../../src/tools/start.js'
import { handleStop } from '../../src/tools/stop.js'

describe('handleStart', () => {
  it('returns RUNNING when PLC starts successfully', async () => {
    const client = {
      startPlc: vi.fn().mockResolvedValue('PLC started successfully'),
      getStatus: vi.fn().mockResolvedValue('RUNNING'),
    }
    const result = await handleStart(client as any)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('RUNNING')
    expect(result.requestedStatus).toBe('RUNNING')
  })

  it('returns success false when status is not RUNNING after start', async () => {
    const client = {
      startPlc: vi.fn().mockResolvedValue('No PLC program loaded'),
      getStatus: vi.fn().mockResolvedValue('EMPTY'),
    }
    const result = await handleStart(client as any)
    expect(result.success).toBe(false)
    expect(result.actualStatus).toBe('EMPTY')
  })
})

describe('handleStop', () => {
  it('returns STOPPED when PLC stops', async () => {
    const client = {
      stopPlc: vi.fn().mockResolvedValue('PLC stopped successfully'),
      getStatus: vi.fn().mockResolvedValue('STOPPED'),
    }
    const result = await handleStop(client as any)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('STOPPED')
  })
})

describe('start/stop retry (regression for "Stop did not stop")', () => {
  it('handleStop re-issues stopPlc when the first attempt does not settle on STOPPED', async () => {
    // First stop attempt: runtime ignores it, stays RUNNING (stable wrong state).
    // Second attempt: it takes — STOPPED for real.
    const statusSeq = [
      'RUNNING', 'RUNNING', 'RUNNING',   // attempt 1 awaitStable → gives up as RUNNING
      'STOPPED', 'STOPPED',              // attempt 2 awaitStable → STOPPED confirmed
    ]
    let i = 0
    const client = {
      stopPlc: vi.fn().mockResolvedValue('STOP:OK'),
      getStatus: vi.fn().mockImplementation(async () => statusSeq[Math.min(i++, statusSeq.length - 1)]),
    }
    const result = await handleStop(client as any)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('STOPPED')
    // stopPlc must have been called at least twice (retry kicked in)
    expect((client.stopPlc as any).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('handleStart re-issues startPlc when the first attempt does not settle on RUNNING', async () => {
    const statusSeq = [
      'STOPPED', 'STOPPED', 'STOPPED',   // attempt 1 → gives up as STOPPED
      'RUNNING', 'RUNNING',              // attempt 2 → RUNNING confirmed
    ]
    let i = 0
    const client = {
      startPlc: vi.fn().mockResolvedValue('START:OK'),
      getStatus: vi.fn().mockImplementation(async () => statusSeq[Math.min(i++, statusSeq.length - 1)]),
    }
    const result = await handleStart(client as any)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('RUNNING')
    expect((client.startPlc as any).mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('handleStop gives up after MAX_ATTEMPTS if runtime never stops', async () => {
    const client = {
      stopPlc: vi.fn().mockResolvedValue('STOP:ERROR'),
      getStatus: vi.fn().mockResolvedValue('RUNNING'),
    }
    const result = await handleStop(client as any)
    expect(result.success).toBe(false)
    expect(result.actualStatus).toBe('RUNNING')
    expect((client.stopPlc as any).mock.calls.length).toBe(3)
  })
})

describe('handleStart wedged-runtime fast-fail (regression for ~48s start timeout)', () => {
  it('fails fast when the runtime is wedged (persistent "No response from runtime") — no 3x retry', async () => {
    // The wedged-runtime signature: /api/status keeps returning the non-canonical
    // "No response from runtime" and never reaches RUNNING. Old behavior burned
    // 3 attempts × 15s = 45s of dead waiting (pushing buildAndRun past the 60s MCP
    // timeout). New behavior: bail after maxNonCanonical consecutive non-canonical
    // reads, and do NOT re-issue start (retrying just re-waits on a dead runtime).
    const client = {
      startPlc: vi.fn().mockResolvedValue('START:OK'),
      getStatus: vi.fn().mockResolvedValue('No response from runtime'),
    }
    const result = await handleStart(client as any, { pollMs: 1, maxNonCanonical: 5, maxMs: 5000 })
    expect(result.success).toBe(false)
    expect(result.actualStatus).toBe('No response from runtime')
    // fast-fail: start issued exactly once (no 3x retry), and we bailed at the
    // non-canonical threshold rather than polling the full maxMs.
    expect((client.startPlc as any).mock.calls.length).toBe(1)
    expect((client.getStatus as any).mock.calls.length).toBeLessThanOrEqual(7)
  })

  it('still recovers when "No response" is only a brief transient before RUNNING', async () => {
    const statuses = ['No response from runtime', 'No response from runtime', 'RUNNING', 'RUNNING']
    let i = 0
    const client = {
      startPlc: vi.fn().mockResolvedValue('START:OK'),
      getStatus: vi.fn().mockImplementation(async () => statuses[Math.min(i++, statuses.length - 1)]),
    }
    const result = await handleStart(client as any, { pollMs: 1, maxNonCanonical: 5, maxMs: 5000 })
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('RUNNING')
  })
})

describe('handleStop fast-fail + opts', () => {
  it('aborts retries when status is non-canonical (wedged runtime)', async () => {
    let stopCalls = 0
    const client = {
      stopPlc: async () => { stopCalls++; return 'ok' },
      getStatus: async () => 'No response from runtime',
    } as any
    const r = await handleStop(client, { maxMs: 300, pollMs: 20, maxNonCanonical: 3 })
    expect(r.success).toBe(false)
    expect(stopCalls).toBe(1)            // 不再盲目重发 3 次
    expect(r.message).toMatch(/unresponsive|wedged/i)
  })
  it('opts are forwarded to awaitStableStatus (maxMs bounds total retries)', async () => {
    // RUNNING/STOPPED alternating: consecutiveWrongSame never accumulates to
    // requiredMatches+1 (needs 3 same consecutive), so awaitStableStatus polls
    // until maxMs expires — proving maxMs is the per-attempt settle budget.
    let toggle = false
    const client = {
      stopPlc: async () => 'ok',
      getStatus: async () => { toggle = !toggle; return toggle ? 'RUNNING' : 'STOPPED' },
    } as any
    const maxMs = 150
    const t0 = Date.now()
    await handleStop(client, { maxMs, pollMs: 20 })
    const elapsed = Date.now() - t0
    // Each of the (up to 3) attempts should burn roughly maxMs — single-attempt
    // lower bound proves maxMs is per-attempt, not a global cap.
    expect(elapsed).toBeGreaterThanOrEqual(maxMs * 0.8)
    // Upper bound: 3 attempts × maxMs + scheduling slack
    expect(elapsed).toBeLessThan(3 * maxMs + 500)
  })
})

describe('awaitStableStatus polling (regression for transient-state race)', () => {
  it('handleStart waits past transient INIT/STOPPED flicker before settling on RUNNING', async () => {
    // Simulate the real OpenPLC sequence: start-plc returns, then the
    // runtime takes a few scan cycles to actually transition. First two
    // status reads see the in-flight state; third onward sees RUNNING.
    const statuses = ['STOPPED', 'INIT', 'RUNNING', 'RUNNING', 'RUNNING']
    let i = 0
    const client = {
      startPlc: vi.fn().mockResolvedValue('PLC started successfully'),
      getStatus: vi.fn().mockImplementation(async () => statuses[Math.min(i++, statuses.length - 1)]),
    }
    const result = await handleStart(client as any)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('RUNNING')
    // Must have polled multiple times (not single-shot)
    expect((client.getStatus as any).mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('handleStop waits through the post-stop RUNNING flicker before confirming STOPPED', async () => {
    // Real OpenPLC pattern: status briefly shows STOPPED, then RUNNING for one
    // more scan, then STOPPED for real. A single-shot post-stop check would
    // catch one of the in-between RUNNINGs and report failure.
    const statuses = ['RUNNING', 'STOPPED', 'RUNNING', 'STOPPED', 'STOPPED', 'STOPPED']
    let i = 0
    const client = {
      stopPlc: vi.fn().mockResolvedValue('PLC stopped successfully'),
      getStatus: vi.fn().mockImplementation(async () => statuses[Math.min(i++, statuses.length - 1)]),
    }
    const result = await handleStop(client as any)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('STOPPED')
    expect((client.getStatus as any).mock.calls.length).toBeGreaterThanOrEqual(4)
  })
})
