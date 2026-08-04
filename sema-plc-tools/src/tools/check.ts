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

// 容器内的落点必须每次不同。写死 /tmp/plc_check_input.st 时,Save All、多文件
// format-on-save、或快速切换两个文件各存一次都会并发跑两次 handleCheck:A 的源码被 B 的
// docker cp 覆盖后,`plc --check` 跑的是 B,而诊断被挂到 A 上。直接复用 mkdtemp 已经
// 随机化的目录名当文件名,不再多拉一个 crypto。
// 不变量(消费方按此区分 stdlib 报错与用户代码报错):送进 `plc --check` 的文件只有这一个
// 输入 + cfg.checkStdlibDir 下的 stdlib,所以「路径不在 checkStdlibDir 下」⇔「是用户代码」。
export function makeCheckPlan(tmpDir: string, cfg: PlcConfig): { remoteSt: string; script: string } {
  const remoteSt = `/tmp/${path.basename(tmpDir)}.st`
  const skip = SKIP_STDLIB.join('|')
  return {
    remoteSt,
    script:
      `STD=$(ls ${cfg.checkStdlibDir}/*.st 2>/dev/null | grep -Ev "${skip}"); ` +
      `plc --check '${remoteSt}' $STD 2>&1`,
  }
}

// Real exec: docker cp the source into the container, run `plc --check` with the
// stdlib decls (minus the panic-prone files), merge stderr→stdout, capture exit code.
async function realCheckExec(stCode: string, cfg: PlcConfig): Promise<{ stdout: string; exitCode: number }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-check-'))
  const stFile = path.join(tmpDir, 'check_input.st')
  const { remoteSt, script } = makeCheckPlan(tmpDir, cfg)
  try {
    fs.writeFileSync(stFile, stCode, 'utf8')
    await execFileAsync(cfg.dockerBin, ['cp', stFile, `${cfg.container}:${remoteSt}`])
    const { stdout } = await execFileAsync(
      cfg.dockerBin, ['exec', cfg.container, 'bash', '-c', script],
      { maxBuffer: 10 * 1024 * 1024 },
    )
    return { stdout, exitCode: 0 }
  } catch (err: any) {
    return { stdout: (err.stdout ?? '') + (err.stderr ?? ''), exitCode: err.code ?? 1 }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    // 随机名意味着不清理就会在容器 /tmp 里无限堆积;清理失败无所谓,别盖掉真正的结果。
    await execFileAsync(cfg.dockerBin, ['exec', cfg.container, 'rm', '-f', remoteSt]).catch(() => {})
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
