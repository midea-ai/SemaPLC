import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleBuildAndRun } from '../../src/tools/buildAndRun.js'
import type { CompileResult, UploadResult, StartStopResult } from '../../src/types.js'

afterEach(() => vi.restoreAllMocks())

const okCompile: CompileResult = {
  success: true, failedStage: null,
  iec2c: { success: true, errors: [], warnings: [], generatedFiles: [] },
  xml2st: { debugSuccess: true, glueVarsSuccess: true, errors: [] },
  variableMap: [], zipPath: '/tmp/ok.zip', errorSummary: 'OK',
}
const okUpload: UploadResult = {
  success: true, uploadOk: true, uploadError: null,
  gccStatus: 'SUCCESS', gccLogs: ['Build OK'], gccErrors: [], durationMs: 100,
}
const okStart: StartStopResult = {
  success: true, requestedStatus: 'RUNNING', actualStatus: 'RUNNING',
  message: 'PLC started successfully',
}

describe('handleBuildAndRun', () => {
  it('returns RUNNING on full success', async () => {
    const deps = {
      compile: vi.fn().mockResolvedValue(okCompile),
      upload: vi.fn().mockResolvedValue(okUpload),
      start: vi.fn().mockResolvedValue(okStart),
    }
    const result = await handleBuildAndRun({ stCode: 'PROGRAM foo END_PROGRAM' }, deps)
    expect(result.success).toBe(true)
    expect(result.finalStatus).toBe('RUNNING')
    expect(result.failedStage).toBeNull()
    expect(result.agentSummary).toContain('RUNNING')
  })

  it('stops at compile stage and sets failedStage=compile', async () => {
    const failCompile: CompileResult = {
      ...okCompile,
      success: false, failedStage: 'iec2c',
      iec2c: { success: false, errors: [{ line: 3, col: 1, message: 'Syntax error', severity: 'error', sourceLine: '' }], warnings: [], generatedFiles: [] },
      errorSummary: 'iec2c error at line 3: Syntax error',
    }
    const deps = {
      compile: vi.fn().mockResolvedValue(failCompile),
      upload: vi.fn(),
      start: vi.fn(),
    }
    const result = await handleBuildAndRun({ stCode: 'bad' }, deps)
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('compile')
    expect(deps.upload).not.toHaveBeenCalled()
    expect(result.agentSummary).toContain('iec2c')
  })

  it('stops at gcc stage when upload GCC fails', async () => {
    const failUpload: UploadResult = {
      ...okUpload, success: false, gccStatus: 'FAILED',
      gccErrors: ['error: undefined reference to TON'],
    }
    const deps = {
      compile: vi.fn().mockResolvedValue(okCompile),
      upload: vi.fn().mockResolvedValue(failUpload),
      start: vi.fn(),
    }
    const result = await handleBuildAndRun({ stCode: 'ok' }, deps)
    expect(result.success).toBe(false)
    expect(result.failedStage).toBe('gcc')
    expect(deps.start).not.toHaveBeenCalled()
    expect(result.agentSummary).toContain('GCC')
  })
})
