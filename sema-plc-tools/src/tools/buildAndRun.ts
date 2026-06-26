import type { BuildAndRunResult, CompileResult, UploadResult, StartStopResult } from '../types.js'

interface BuildAndRunDeps {
  compile: (input: { stCode: string }) => Promise<CompileResult>
  upload: (input: Record<string, never>) => Promise<UploadResult>
  start: () => Promise<StartStopResult>
}

export async function handleBuildAndRun(
  input: { stCode: string },
  deps: BuildAndRunDeps,
): Promise<BuildAndRunResult> {
  const compile = await deps.compile(input)
  if (!compile.success) {
    return {
      success: false,
      failedStage: 'compile',
      compile,
      upload: null,
      start: null,
      finalStatus: null,
      agentSummary: `Compilation failed (${compile.failedStage}): ${compile.errorSummary}`,
    }
  }

  const upload = await deps.upload({})
  if (!upload.success) {
    const stage = (upload.gccStatus === 'FAILED' || upload.gccStatus === 'TIMEOUT') ? 'gcc' : 'upload'
    const detail = stage === 'gcc'
      ? `GCC compilation failed. Errors: ${upload.gccErrors.slice(0, 2).join('; ')}`
      : `Upload failed: ${upload.uploadError}`
    return {
      success: false, failedStage: stage, compile, upload, start: null,
      finalStatus: null, agentSummary: detail,
    }
  }

  const start = await deps.start()
  if (!start.success) {
    return {
      success: false, failedStage: 'start', compile, upload, start,
      finalStatus: start.actualStatus,
      agentSummary: `PLC failed to start. Status: ${start.actualStatus}. Message: ${start.message}`,
    }
  }

  return {
    success: true,
    failedStage: null,
    compile,
    upload,
    start,
    finalStatus: 'RUNNING',
    agentSummary: 'PLC is RUNNING. Use plc.readVariables to verify output values.',
  }
}
