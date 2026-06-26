import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleUpload } from '../../src/tools/upload.js'
import type { PlcConfig } from '../../src/config.js'
import type { PlcState } from '../../src/types.js'

const TMP_STATE = path.join(os.tmpdir(), `upload-test-state-${Date.now()}.json`)
const TMP_ZIP = path.join(os.tmpdir(), `upload-test-${Date.now()}.zip`)

const cfg: PlcConfig = {
  url: 'https://localhost:8443', container: 'c',
  user: 'admin', password: process.env.PLC_TEST_PW ?? 'pw', stateFile: TMP_STATE,
}

beforeEach(() => {
  fs.writeFileSync(TMP_ZIP, Buffer.from('PK'))  // fake zip
  const state: PlcState = {
    lastCompile: {
      timestamp: new Date().toISOString(),
      stCode: 'PROGRAM foo END_PROGRAM',
      zipPath: TMP_ZIP,
      variableMap: [],
    },
  }
  fs.mkdirSync(path.dirname(TMP_STATE), { recursive: true })
  fs.writeFileSync(TMP_STATE, JSON.stringify(state))
})

afterEach(() => {
  vi.restoreAllMocks()
  ;[TMP_STATE, TMP_ZIP].forEach(f => { try { fs.unlinkSync(f) } catch {} })
})

describe('handleUpload gccTimeoutMs opts', () => {
  it('passes gccTimeoutMs to pollCompilationStatus when provided', async () => {
    let capturedTimeoutMs: number | undefined
    const mockClient = {
      uploadZip: vi.fn().mockResolvedValue({ ok: true, error: null }),
      pollCompilationStatus: vi.fn().mockImplementation(async (_intervalMs: number, timeoutMs: number) => {
        capturedTimeoutMs = timeoutMs
        return { status: 'SUCCESS', logs: [], gccErrors: [] }
      }),
    }
    await handleUpload({}, cfg, mockClient as any, { gccTimeoutMs: 1234 })
    expect(capturedTimeoutMs).toBe(1234)
  })

  it('uses default 55000 when gccTimeoutMs not provided', async () => {
    let capturedTimeoutMs: number | undefined
    const mockClient = {
      uploadZip: vi.fn().mockResolvedValue({ ok: true, error: null }),
      pollCompilationStatus: vi.fn().mockImplementation(async (_intervalMs: number, timeoutMs: number) => {
        capturedTimeoutMs = timeoutMs
        return { status: 'SUCCESS', logs: [], gccErrors: [] }
      }),
    }
    await handleUpload({}, cfg, mockClient as any)
    expect(capturedTimeoutMs).toBe(55000)
  })
})

describe('handleUpload', () => {
  it('returns success when upload ok and GCC compiles', async () => {
    const mockClient = {
      uploadZip: vi.fn().mockResolvedValue({ ok: true, error: null }),
      pollCompilationStatus: vi.fn().mockResolvedValue({
        status: 'SUCCESS', logs: ['Build OK'], gccErrors: [],
      }),
    }
    const result = await handleUpload({}, cfg, mockClient as any)
    expect(result.success).toBe(true)
    expect(result.gccStatus).toBe('SUCCESS')
    expect(result.gccLogs).toContain('Build OK')
  })

  it('returns failure when no lastCompile in state', async () => {
    fs.writeFileSync(TMP_STATE, JSON.stringify({ lastCompile: null }))
    const result = await handleUpload({}, cfg, {} as any)
    expect(result.success).toBe(false)
    expect(result.uploadError).toContain('No compiled program')
  })

  it('returns failure when GCC compilation fails', async () => {
    const mockClient = {
      uploadZip: vi.fn().mockResolvedValue({ ok: true, error: null }),
      pollCompilationStatus: vi.fn().mockResolvedValue({
        status: 'FAILED', logs: ['error: undefined reference'], gccErrors: ['error: undefined reference'],
      }),
    }
    const result = await handleUpload({}, cfg, mockClient as any)
    expect(result.success).toBe(false)
    expect(result.gccStatus).toBe('FAILED')
    expect(result.gccErrors).toContain('error: undefined reference')
  })
})
