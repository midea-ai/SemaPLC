import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
import { parseRustyErrors, stripAnsi } from './rustyErrorParser.js'
import type { CheckInput, CheckResult } from '../types.js'
import type { PlcConfig } from '../config.js'

const execFileAsync = promisify(execFile)

// stdlib files that make rusty v0.5.0's `--check` panic — must be excluded.
const SKIP_STDLIB = ['bit_conversion', 'string_conversion', 'string_functions', 'extra_functions']

export type CheckExecFn = (stCode: string, cfg: PlcConfig) => Promise<{ stdout: string; exitCode: number }>

// Real exec: docker cp the source into the container, run `plc --check` with the
// stdlib decls (minus the panic-prone files), merge stderr→stdout, capture exit code.
async function realCheckExec(stCode: string, cfg: PlcConfig): Promise<{ stdout: string; exitCode: number }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-check-'))
  const stFile = path.join(tmpDir, 'check_input.st')
  try {
    fs.writeFileSync(stFile, stCode, 'utf8')
    await execFileAsync('docker', ['cp', stFile, `${cfg.container}:/tmp/plc_check_input.st`])
    const skip = SKIP_STDLIB.join('|')
    const script =
      `STD=$(ls ${cfg.checkStdlibDir}/*.st 2>/dev/null | grep -Ev "${skip}"); ` +
      `plc --check /tmp/plc_check_input.st $STD 2>&1`
    const { stdout } = await execFileAsync(
      'docker', ['exec', cfg.container, 'bash', '-c', script],
      { maxBuffer: 10 * 1024 * 1024 },
    )
    return { stdout, exitCode: 0 }
  } catch (err: any) {
    return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), exitCode: err.code ?? 1 }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

// Syntax/semantic CHECK of ST via rusty. Accepts a bare FUNCTION_BLOCK. Check-only:
// no side effects, no run artifact. ok ⇔ `plc --check` exited 0.
export async function handleCheck(
  input: CheckInput,
  cfg: PlcConfig,
  execFnOverride?: CheckExecFn,
): Promise<CheckResult> {
  if (typeof input?.stCode !== 'string' || !input.stCode.trim()) {
    return { ok: false, errors: [], raw: '', errorMessage: 'stCode is required and must be a non-empty string' }
  }
  const execFn = execFnOverride ?? realCheckExec
  try {
    const { stdout, exitCode } = await execFn(input.stCode, cfg)
    const raw = stripAnsi(stdout).trim()
    if (exitCode === 0) return { ok: true, errors: [], raw, errorMessage: null }
    const errors = parseRustyErrors(stdout)
    if (errors.length > 0) return { ok: false, errors, raw, errorMessage: null }
    return {
      ok: false, errors: [], raw,
      errorMessage: `rusty check failed (exit ${exitCode}) with no parseable diagnostics. ` +
        `Is plc installed in container '${cfg.container}'? Raw: ${raw.slice(0, 200)}`,
    }
  } catch (e) {
    return { ok: false, errors: [], raw: '', errorMessage: `rusty check failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
