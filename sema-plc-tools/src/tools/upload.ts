import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readState } from '../state.js'
import { RuntimeClient } from '../client/runtime.js'
import type { UploadResult } from '../types.js'
import type { PlcConfig } from '../config.js'

const execFileAsync = promisify(execFile)

export async function handleUpload(
  _input: Record<string, never>,
  cfg: PlcConfig,
  clientOverride?: RuntimeClient,
  opts: { gccTimeoutMs?: number } = {},
): Promise<UploadResult> {
  const state = readState(cfg.stateFile)
  if (!state.lastCompile?.zipPath) {
    return {
      success: false, uploadOk: false,
      uploadError: 'No compiled program found. Run plc.compile first.',
      gccStatus: 'FAILED', gccLogs: [], gccErrors: [], durationMs: 0,
    }
  }

  const start = Date.now()
  const client = clientOverride ?? new RuntimeClient(cfg.url, cfg.user, cfg.password)

  // If zipPath doesn't exist on host, try docker cp from container
  let localZipPath = state.lastCompile.zipPath
  let tmpZipPath: string | null = null
  if (!fs.existsSync(localZipPath) && cfg.container) {
    tmpZipPath = path.join(os.tmpdir(), `plc_upload_${Date.now()}.zip`)
    try {
      await execFileAsync(cfg.dockerBin, ['cp', `${cfg.container}:${localZipPath}`, tmpZipPath])
      localZipPath = tmpZipPath
    } catch (e) {
      return {
        success: false, uploadOk: false,
        uploadError: `Cannot copy ZIP from container ${cfg.container}:${localZipPath}: ${e}`,
        gccStatus: 'FAILED', gccLogs: [], gccErrors: [], durationMs: Date.now() - start,
      }
    }
  }

  let zipBuffer: Buffer
  try {
    zipBuffer = fs.readFileSync(localZipPath)
  } catch (e) {
    return {
      success: false, uploadOk: false,
      uploadError: `Cannot read ZIP at ${localZipPath}: ${e}`,
      gccStatus: 'FAILED', gccLogs: [], gccErrors: [], durationMs: Date.now() - start,
    }
  } finally {
    if (tmpZipPath) try { fs.unlinkSync(tmpZipPath) } catch {}
  }

  const upload = await client.uploadZip(zipBuffer, 'program.zip')
  if (!upload.ok) {
    return {
      success: false, uploadOk: false,
      uploadError: upload.error,
      gccStatus: 'FAILED', gccLogs: [], gccErrors: [], durationMs: Date.now() - start,
    }
  }

  const poll = await client.pollCompilationStatus(2000, opts.gccTimeoutMs ?? 55_000)
  const success = poll.status === 'SUCCESS'

  return {
    success,
    uploadOk: true,
    uploadError: null,
    gccStatus: poll.status,
    gccLogs: poll.logs,
    gccErrors: poll.gccErrors,
    durationMs: Date.now() - start,
  }
}
