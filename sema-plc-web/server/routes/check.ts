import { Router } from 'express'
import { handleCheck } from '../../../sema-plc-tools/dist/tools/check.js'
import { dockerBin, type PlcConfig } from '../../../sema-plc-tools/dist/config.js'
import type { CheckResult, RustyError } from '../../../sema-plc-tools/dist/types.js'

export const checkRouter = Router()

/**
 * 一次自检的三态。`ok`(⇔ 进程 exit 0)不够用:rusty v0.5.0 对 stdlib **必 panic**(exit 101),
 * 所以在真实容器上 `ok` 恒为 false,只看它的话干净文件永远显示失败。
 * 与扩展侧同构(`sema-plc-vscode/src/lang/diagnostics.ts` 的 checkOutcome + checkTruncated),
 * 两边必须是一套说法。
 */
export type CheckOutcome =
  | 'errors'    // 有用户代码错误
  | 'passed'    // 无用户代码错误,且检查跑完了
  | 'truncated' // 无用户代码错误,但检查器在 stdlib 上提前退出 —— 后续阶段根本没跑,不能说「通过」

export interface CheckResponse extends CheckResult {
  outcome: CheckOutcome
}

/**
 * 过滤 + 定态。放在 server 而不是前端:判据是「路径不在 checkStdlibDir 下」,而只有这里
 * 拿得到那个目录(前端硬编码默认值 ⇒ 一设 PLC_CHECK_STDLIB_DIR 就全漏)。
 *
 * 送检的文件只有「用户这一个」+「stdlibDir 下的 stdlib」,ST 没有 include、全是显式 argv,
 * 所以路径判据严格等价于「是用户代码」。无 file 的条目留下:rusty 只在有 codespan 位置行时
 * 才给路径,无路径 = 全局性错误(如缺入口),归不到 stdlib 头上。
 */
export function summarizeCheck(result: CheckResult, stdlibDir: string): CheckResponse {
  // 前缀必须带分隔符,否则 /opt/iec61131-stdlib-extra/x.st 会被当成 stdlib 误杀。
  const prefix = stdlibDir.endsWith('/') ? stdlibDir : `${stdlibDir}/`
  const errors = result.errors.filter((e: RustyError) => !e.file || !e.file.startsWith(prefix))
  return {
    ...result,
    errors,
    outcome: errors.length > 0 ? 'errors' : /panicked at/.test(result.raw) ? 'truncated' : 'passed',
  }
}

// rusty `plc --check` only reads container + checkStdlibDir; the rest are
// placeholders to satisfy the PlcConfig shape (same defaults as plc-controller).
function checkConfig(): PlcConfig {
  return {
    url: process.env.PLC_URL ?? 'https://localhost:8443',
    container: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
    checkStdlibDir: process.env.PLC_CHECK_STDLIB_DIR ?? '/opt/iec61131-stdlib',
    user: process.env.PLC_USER ?? 'admin',
    password: process.env.PLC_PASSWORD ?? 'admin123',
    stateFile: '',
    poolSize: Number(process.env.PLC_POOL_SIZE) || 1, // 占位:check 不消费 poolSize
    dockerBin: dockerBin(),
  }
}

checkRouter.post('/check', async (req, res) => {
  const stCode = req.body?.stCode
  if (typeof stCode !== 'string' || !stCode.trim()) {
    return res.status(400).json({ ok: false, errors: [], raw: '', errorMessage: 'stCode is required (non-empty string)' })
  }
  try {
    const cfg = checkConfig()
    res.json(summarizeCheck(await handleCheck({ stCode }, cfg), cfg.checkStdlibDir))
  } catch (e: any) {
    res.status(500).json({ ok: false, errors: [], raw: '', errorMessage: e?.message ?? String(e) })
  }
})
