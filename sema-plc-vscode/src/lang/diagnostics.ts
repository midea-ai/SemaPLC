import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import * as vscode from 'vscode'
import { stripConfigurationBlock } from './ast'
import { containerName, resolveBin } from '../runtime-guide'
import type { PlcConfig } from '../../../sema-plc-tools/src/config'
import type { CheckResult, RustyError } from '../../../sema-plc-tools/src/types'

/**
 * 诊断通道 A:保存 .st 时跑 rusty `plc --check`,结果进 Problems 面板(方案 §5 第 1 步)。
 * (通道 B —— Run 时的 matiec 编译错 —— 是另一个 DiagnosticCollection,第 3 步接。)
 *
 * 不走 server:直接动态 import 打进 VSIX 的 plc-tools 产物,少一层生死耦合。
 * 纯逻辑(过滤 / 坐标换算 / 该不该动 collection / 单飞排队)都在分隔线以上,不碰 vscode,单测不必造壳。
 */

// 容器内 rusty 的 StandardFunctions 目录。与 sema-plc-web/server/routes/check.ts 的默认值一致;
// 扩展侧没有对应设置项,真要改是加一条 semaplc.check.stdlibDir,今天没人需要。
const STDLIB_DIR = '/opt/iec61131-stdlib'

/** 一条已经换算成 VSCode 坐标(行列双 0-based)的诊断,构造 vscode.Diagnostic 前的中间形态。 */
export interface StDiagnostic {
  line: number
  col: number
  code: string
  message: string
}

function clamp(n: number, max: number): number {
  return n < 0 ? 0 : n > max ? max : n
}

/**
 * 一次 check 的结果该怎么落到 Problems 面板。
 *
 * 返回 `null` = **别动 collection**:`errorMessage` 非空只有基础设施故障一种成因
 * (docker 没装 / 容器没起 / 容器里没有 plc)。把这个渲染成用户代码里的红波浪线比没有诊断更糟,
 * 而清空又会把上一次真实的错误抹掉。返回数组 = 覆盖,空数组即「这次干净了」。
 *
 * 数组里做三件事:
 * 1. **滤掉 stdlib**。一次 `plc --check` 连同十几个 stdlib .st 一起送检,实测 29 条 error 里
 *    28 条来自 stdlib(带着 stdlib 的行号)。送检的文件只有「这一个输入」+「stdlibDir 下的 stdlib」,
 *    ST 没有 include、全是显式 argv,所以「路径不在 stdlibDir 下」严格等价于「是用户代码」。
 *    没有路径的条目留下:rusty 只在有 codespan 位置行时才给路径,无路径 = 全局性错误(如缺入口),
 *    它归不到 stdlib 头上,丢掉反而会让用户什么都看不到。
 * 2. **1-based → 0-based**。rusty 的 `┌─ f:45:1` 行列都是 1-based,vscode.Position 双 0-based。
 * 3. **钳制**。line 可能为 null(无位置行)或超出文档行数(保存后文件又被外部改过),
 *    越界的 Position 会让 getWordRangeAtPosition 抛异常。
 */
export function checkOutcome(result: CheckResult, stdlibDir: string, lineCount: number): StDiagnostic[] | null {
  if (result.errorMessage) return null
  // 前缀必须带分隔符:否则 /opt/iec61131-stdlib-extra/x.st 会被当成 stdlib 误杀。
  const prefix = stdlibDir.endsWith('/') ? stdlibDir : `${stdlibDir}/`
  return result.errors
    .filter((e: RustyError) => !e.file || !e.file.startsWith(prefix))
    .map((e: RustyError) => ({
      line: clamp((e.line ?? 1) - 1, Math.max(0, lineCount - 1)),
      col: clamp((e.col ?? 1) - 1, Number.MAX_SAFE_INTEGER),
      code: e.code,
      message: e.message,
    }))
}

/**
 * 这次检查是不是**半途崩掉**的。
 *
 * rusty v0.5.0 对 stdlib 必 panic(typesystem.rs:742,exit 101):panic 点之后的检查阶段根本没跑过。
 * 用户代码的错在 panic 之前仍报得出来,所以照常填 Problems —— 返回 null 不动面板等于把这个功能
 * 整个关掉(每次都 panic)。但 0 条错**不等于**代码没问题,提示语不能说「检查通过」。
 */
export function checkTruncated(raw: string): boolean {
  return /panicked at/.test(raw)
}

/**
 * per-uri 单飞 + 尾随补跑。一次往返实测 0.42s(含 docker cp + exec),连按 Cmd+S 会把容器打爆;
 * 但把飞行途中来的那次直接丢掉,Problems 里留的就是**上一版内容算出的行号** —— 所以跑完再补一次。
 * value = 「跑完还欠一次」;途中来几次都合并成一次,反正补跑读的是那时最新的文档内容。
 */
const inflight = new Map<string, boolean>()

export async function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T | null> {
  if (inflight.has(key)) {
    inflight.set(key, true)
    return null
  }
  inflight.set(key, false)
  try {
    return await run()
  } finally {
    const queued = inflight.get(key)
    inflight.delete(key) // 先删再补跑,否则补跑那次会撞上自己留下的 key
    if (queued) void singleFlight(key, run)
  }
}

// ── 以下是 vscode 适配层 ────────────────────────────────────────────────────

type HandleCheck = (input: { stCode: string }, cfg: PlcConfig) => Promise<CheckResult>

let checkModule: Promise<HandleCheck> | undefined

/** VSIX 里的 vendor 优先,回退开发态的兄弟仓库 —— 与 server-manager 找 server 入口是同一套回退。 */
function loadCheck(ctx: vscode.ExtensionContext): Promise<HandleCheck> {
  return (checkModule ??= (async () => {
    const entry = [
      path.join(ctx.extensionPath, 'vendor', 'plc-tools', 'dist', 'tools', 'check.js'),
      path.join(ctx.extensionPath, '..', 'sema-plc-tools', 'dist', 'tools', 'check.js'),
    ].find((p) => fs.existsSync(p))
    if (!entry) throw new Error('找不到 check.js(vendor/plc-tools 与 ../sema-plc-tools/dist 都没有;先 npm run build)')
    // check.js 是 ESM 而扩展 bundle 是 CJS,只能动态 import;路径必须转 file:// URL,
    // 否则 Windows 的 `C:\...` 会被当成协议头解析。esbuild 对非字面量的 import() 保留原样,不会降级成 require。
    return (await import(pathToFileURL(entry).href)).handleCheck
  })())
}

/**
 * rusty 只读 container / checkStdlibDir / dockerBin,其余是凑 PlcConfig 形状的占位(照搬 routes/check.ts)。
 * 容器名走 runtime-guide 的 containerName():那里已有白名单,非法名在这里静默失败最难查;
 * 抛出来会被 runCheckOnce 的 catch 接住写进 Output,collection 一个字都不动。
 */
export function checkConfig(bin: string): PlcConfig {
  const cfg = vscode.workspace.getConfiguration('semaplc')
  return {
    url: cfg.get<string>('plcUrl') || 'https://localhost:8443',
    container: containerName(),
    checkStdlibDir: STDLIB_DIR,
    user: 'admin',
    password: 'admin123',
    stateFile: '',
    poolSize: 1,
    dockerBin: bin,
  }
}

function toVscode(doc: vscode.TextDocument, d: StDiagnostic): vscode.Diagnostic {
  // validateRange 顺手把列号也钳进本行长度 —— 列宽只有 TextDocument 知道,别自己数。
  const start = doc.validateRange(new vscode.Range(d.line, d.col, d.line, d.col)).start
  // rusty 的 codespan 头只给起点,末端得自己撑出来,否则波浪线是个看不见的零宽点。
  const diag = new vscode.Diagnostic(
    doc.getWordRangeAtPosition(start) ?? new vscode.Range(start, start),
    d.message,
    vscode.DiagnosticSeverity.Error,
  )
  diag.code = d.code
  diag.source = 'plc --check'
  return diag
}

/** 一次检查的结果:诊断条数 + 检查器是不是半途崩掉的(见 checkTruncated)。 */
interface CheckRun {
  n: number
  truncated: boolean
}

/** 跑一次检查。null = 没跑成/降级/被并进正在飞的那次(collection 未被改动,原因已写进 out)。 */
function runCheck(
  ctx: vscode.ExtensionContext,
  doc: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  out: vscode.OutputChannel,
): Promise<CheckRun | null> {
  return singleFlight(doc.uri.toString(), () => runCheckOnce(ctx, doc, collection, out))
}

async function runCheckOnce(
  ctx: vscode.ExtensionContext,
  doc: vscode.TextDocument,
  collection: vscode.DiagnosticCollection,
  out: vscode.OutputChannel,
): Promise<CheckRun | null> {
  try {
    // semaplc.container.bin 的默认值是空串(留空=自动探测)。直接塞 dockerBin 就是 execFile("")
    // ⇒ ENOENT ⇒ errorMessage 非空 ⇒ 走上面的降级路径 ⇒ 默认配置下诊断永远不出现且不报错。
    // resolveBin 会话内缓存,NO_ENGINE 时后续调用直接返回 null,不会反复探测。
    const bin = await resolveBin(out)
    if (!bin) return null
    const handleCheck = await loadCheck(ctx)
    // 真实 .st 结尾都有 CONFIGURATION(OpenPLC 硬要求),原样送检会吐 21 条 E007 幽灵错。
    // 等长空白替换 ⇒ rusty 报回来的行列号仍是原文的行列号,不需要任何映射。
    const result = await handleCheck({ stCode: stripConfigurationBlock(doc.getText()) }, checkConfig(bin))
    const outcome = checkOutcome(result, STDLIB_DIR, doc.lineCount)
    if (!outcome) {
      out.appendLine(`[check] ${doc.uri.fsPath}:${result.errorMessage}`)
      return null
    }
    const truncated = checkTruncated(result.raw)
    if (truncated) {
      out.appendLine(`[check] ${doc.uri.fsPath}:rusty 在 stdlib 上 panic 提前退出(exit 101),panic 之后的检查阶段未执行`)
    }
    collection.set(
      doc.uri,
      outcome.map((d) => toVscode(doc, d)),
    )
    return { n: outcome.length, truncated }
  } catch (e) {
    // 动态 import 失败、docker 子进程被 reject、容器名非法等都落这:
    // 同样只写日志,绝不画成用户代码的错。
    out.appendLine(`[check] ${doc.uri.fsPath}:${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

/**
 * 注册通道 A。返回 collection 供调用方决定是否复用(通道 B 是另一个,不共用)。
 *
 * 只有保存与手动命令两个触发点,**不做 onDidChangeTextDocument 防抖**:一次往返 0.42s,
 * 边打字边触发等于持续对容器发 docker cp + exec。
 */
export function registerStDiagnostics(
  ctx: vscode.ExtensionContext,
  out: vscode.OutputChannel,
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('semaplc-check')
  ctx.subscriptions.push(
    collection,

    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId !== 'st') return
      // 每次读设置而不是注册时读一次:拨开关立刻生效,不用 reload 窗口。
      // 默认 false —— 单文件送检对「引用了兄弟文件里 FUNCTION_BLOCK」的多文件工程会满屏假错。
      if (!vscode.workspace.getConfiguration('semaplc').get<boolean>('check.onSave')) return
      void runCheck(ctx, doc, collection, out)
    }),

    // 关掉的文件留在 Problems 里就是脏数据:下次打开时内容可能已经在别处改好了。
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),

    vscode.commands.registerCommand('semaplc.check', async () => {
      const doc = vscode.window.activeTextEditor?.document
      if (!doc || doc.languageId !== 'st') {
        void vscode.window.showInformationMessage('SemaPLC:请先打开一个 .st 文件')
        return
      }
      const run = await runCheck(ctx, doc, collection, out)
      // 手动触发必须有回音:0 条时 Problems 面板什么都不变,不说一声用户分不清「通过」和「没跑」。
      // 但检查器 panic 提前退出时也是 0 条,那句「通过」是假绿 —— 得把「只检到一半」说出来。
      if (run === null) out.show(true)
      else if (run.n === 0) {
        void vscode.window.showInformationMessage(
          run.truncated
            ? 'SemaPLC:未发现用户代码问题(检查器在 stdlib 上提前退出,后续阶段未检查)'
            : 'SemaPLC:检查通过,未发现问题',
        )
      }
    }),
  )
  return collection
}
