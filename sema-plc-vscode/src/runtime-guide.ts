import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'
import { execFile, execFileSync, spawn } from 'child_process'

/**
 * 容器探测与引导状态机(方案 §4.6)。
 *
 *   探测 bin(settings semaplc.container.bin → docker → podman,`<bin> info` 判活)
 *     ├─ 都不活 ───────────────────────────────► NO_ENGINE(返回 unavailable,不弹错误栈)
 *     ├─ 容器在跑 ─────────────────────────────► ready
 *     ├─ 容器存在但停了 ── `<bin> start` ───────► ready
 *     ├─ 镜像在、容器不在 ── compose up -d ─────► ready
 *     └─ 镜像不在 ── 确认后 compose up -d --build ► ready
 *
 * 只在用户显式触发 PLC 动作(Run / runtime.start 命令等)时调用,激活路径绝不碰容器。
 */

// 与 sema-plc-tools/src/config.ts 同款白名单:任何值进 execFile 前先过正则(防注入)。
const CONTAINER_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const BIN_RE = /^[A-Za-z0-9._/-]+$/
// compose 里钉死的镜像名(sema-plc-tools/runtime/docker-compose.yml)。
const IMAGE = 'openplc-plc-dev:latest'

let cachedBin: string | null | undefined // undefined=未探测,null=NO_ENGINE
let buildDeclined = false

// 诊断通道的 checkConfig 也要用它:容器名会原样进 docker exec 的 argv,少一处校验就是少一道防注入。
export function containerName(): string {
  const raw = vscode.workspace.getConfiguration('semaplc').get<string>('container.name') || 'openplc-plc-dev'
  if (!CONTAINER_RE.test(raw)) throw new Error(`容器名 '${raw}' 非法:必须匹配 ${CONTAINER_RE}`)
  return raw
}

/** execFile 探针:成功返回 stdout,失败返回 null(命令不存在/退出码非 0 都算失败)。 */
function probe(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 20_000 }, (err, stdout) => resolve(err ? null : stdout))
  })
}

/** 探测可用的容器 bin;失败返回 null(NO_ENGINE)。结果缓存在会话内。 */
// 诊断通道也要用它:semaplc.container.bin 默认是空串,直塞 PlcConfig.dockerBin 就是 execFile("")。
export async function resolveBin(out: vscode.OutputChannel): Promise<string | null> {
  if (cachedBin !== undefined) return cachedBin
  const configured = vscode.workspace.getConfiguration('semaplc').get<string>('container.bin')?.trim()
  const candidates = configured ? [configured] : ['docker', 'podman']
  for (const bin of candidates) {
    if (!BIN_RE.test(bin)) {
      out.appendLine(`[runtime] 忽略非法的 semaplc.container.bin '${bin}'`)
      continue
    }
    if (await probe(bin, ['info'])) {
      out.appendLine(`[runtime] 容器引擎:${bin}`)
      cachedBin = bin
      return bin
    }
    out.appendLine(`[runtime] ${bin} info 失败(未安装,或守护进程未启动)`)
  }
  cachedBin = null
  return null
}

/** 跑一条容器命令,stdout/stderr 逐行进 OutputChannel(build 要几分钟,必须有实时日志)。 */
function run(bin: string, args: string[], out: vscode.OutputChannel): Promise<void> {
  out.appendLine(`[runtime] $ ${bin} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const pipe = (s: NodeJS.ReadableStream) => {
      s.setEncoding('utf8')
      s.on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) if (line.trim()) out.appendLine(`  ${line.trimEnd()}`)
      })
    }
    pipe(p.stdout)
    pipe(p.stderr)
    p.on('error', reject)
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${bin} ${args[0]} 退出码 ${code}(详见 SemaPLC 输出面板)`)),
    )
  })
}

/** compose 文件:VSIX 内 vendor/ 优先,回退开发态的兄弟仓库。 */
function composeFile(ctx: vscode.ExtensionContext): string {
  const packaged = path.join(ctx.extensionPath, 'vendor', 'plc-tools', 'runtime', 'docker-compose.yml')
  if (fs.existsSync(packaged)) return packaged
  return path.join(ctx.extensionPath, '..', 'sema-plc-tools', 'runtime', 'docker-compose.yml')
}

function composeArgs(ctx: vscode.ExtensionContext, build: boolean): string[] {
  const file = composeFile(ctx)
  if (!fs.existsSync(file)) throw new Error(`找不到 compose 文件:${file}`)
  return ['compose', '-f', file, 'up', '-d', ...(build ? ['--build'] : [])]
}

function withProgress<T>(title: string, task: () => Promise<T>): Thenable<T> {
  return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, task)
}

/** NO_ENGINE 引导:不弹错误栈,写一段 markdown 说明进 Output + 「查看说明」按钮。 */
function showNoEngineGuide(ctx: vscode.ExtensionContext, out: vscode.OutputChannel): void {
  out.appendLine(
    [
      '',
      '## PLC 运行时不可用(未检测到容器引擎)',
      '',
      'SemaPLC 的编译/运行依赖一个本地容器运行时。三选一即可:',
      '',
      '1. 安装 **Docker Desktop / Docker Engine**,并确保已启动(`docker info` 能通)。',
      '2. 使用 **Podman**:安装后 `podman machine start`,插件会自动探测;',
      '   自定义路径填设置 `semaplc.container.bin`。',
      '3. 不想装容器:把设置 `semaplc.plcUrl` 指向远程 / 实机的 OpenPLC REST 地址。',
      '',
      '面板的对话、编辑、梯形图预览等功能不受影响。',
      '',
    ].join('\n'),
  )
  void vscode.window
    .showInformationMessage('SemaPLC:未检测到 Docker / Podman,PLC 运行时不可用', '查看说明')
    .then((pick) => {
      if (pick !== '查看说明') return
      const doc = path.join(path.dirname(composeFile(ctx)), 'DEPLOY.md')
      if (fs.existsSync(doc)) void vscode.commands.executeCommand('markdown.showPreview', vscode.Uri.file(doc))
      else out.show(true)
    })
}

export async function ensurePlcRuntime(
  ctx: vscode.ExtensionContext,
  out: vscode.OutputChannel,
): Promise<'ready' | 'unavailable'> {
  let name: string
  try {
    name = containerName()
  } catch (e) {
    void vscode.window.showErrorMessage(`SemaPLC:${e instanceof Error ? e.message : String(e)}`)
    return 'unavailable'
  }

  const bin = await resolveBin(out)
  if (!bin) {
    showNoEngineGuide(ctx, out)
    return 'unavailable'
  }

  try {
    // --type container 必带:不加时 inspect 会退而匹配同名镜像,State 渲染成空串,误判成"容器存在但停了"。
    // inspect 失败=容器不存在;成功时 stdout 是 'true'/'false'(是否在跑)。
    const state = await probe(bin, ['inspect', '--type', 'container', '-f', '{{.State.Running}}', name])
    if (state !== null) {
      if (state.trim() === 'true') return 'ready'
      // 唯一允许的启动类命令:只在用户显式触发 PLC 动作的调用链里执行。
      await withProgress('启动 PLC 运行时容器…', () => run(bin, ['start', name], out))
      return 'ready'
    }

    if (await probe(bin, ['image', 'inspect', IMAGE])) {
      await withProgress('创建 PLC 运行时容器…', () => run(bin, composeArgs(ctx, false), out))
      return 'ready'
    }

    if (buildDeclined) {
      out.appendLine('[runtime] 用户已拒绝构建镜像,本次会话不再询问')
      return 'unavailable'
    }
    const pick = await vscode.window.showInformationMessage(
      '首次使用需要构建 PLC 运行时镜像(需要网络,约几分钟)。现在构建?',
      { modal: true },
      '构建',
    )
    if (pick !== '构建') {
      buildDeclined = true
      return 'unavailable'
    }
    out.show(true)
    await withProgress('构建 PLC 运行时镜像(首次约几分钟)…', () => run(bin, composeArgs(ctx, true), out))
    return 'ready'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    out.appendLine(`[runtime] 失败:${msg}`)
    void vscode.window.showErrorMessage(`SemaPLC:PLC 运行时准备失败 —— ${msg}`)
    return 'unavailable'
  }
}

export function registerRuntimeCommands(ctx: vscode.ExtensionContext, out: vscode.OutputChannel): void {
  ctx.subscriptions.push(
    // 改了 bin 设置就丢掉探测缓存,否则要重启 VSCode 才认新值。
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('semaplc.container.bin')) cachedBin = undefined
    }),

    vscode.commands.registerCommand('semaplc.runtime.start', async () => {
      if ((await ensurePlcRuntime(ctx, out)) === 'ready') {
        void vscode.window.showInformationMessage('SemaPLC:PLC 运行时已就绪')
      }
    }),

    vscode.commands.registerCommand('semaplc.runtime.stop', async () => {
      const bin = await resolveBin(out)
      if (!bin) return showNoEngineGuide(ctx, out)
      try {
        await withProgress('停止 PLC 运行时…', () => run(bin, ['stop', containerName()], out))
        void vscode.window.showInformationMessage('SemaPLC:PLC 运行时已停止')
      } catch (e) {
        void vscode.window.showErrorMessage(`SemaPLC:停止失败 —— ${e instanceof Error ? e.message : String(e)}`)
      }
    }),

    vscode.commands.registerCommand('semaplc.runtime.rebuild', async () => {
      const bin = await resolveBin(out)
      if (!bin) return showNoEngineGuide(ctx, out)
      try {
        out.show(true)
        await withProgress('重建 PLC 运行时镜像…', () => run(bin, composeArgs(ctx, true), out))
        buildDeclined = false
        void vscode.window.showInformationMessage('SemaPLC:运行时镜像已重建')
      } catch (e) {
        void vscode.window.showErrorMessage(`SemaPLC:重建失败 —— ${e instanceof Error ? e.message : String(e)}`)
      }
    }),

    // stopOnExit:dispose 是同步的,窗口关闭后异步 spawn 未必跑得完,这里用 execFileSync 兜底。
    // ponytail: 阻塞几百毫秒换确定性;真嫌慢再改 detached spawn。
    {
      dispose: () => {
        if (!vscode.workspace.getConfiguration('semaplc').get<boolean>('runtime.stopOnExit')) return
        if (!cachedBin) return // 本会话没探测过引擎 = 没碰过容器,不多此一举
        try {
          execFileSync(cachedBin, ['stop', containerName()], { timeout: 20_000, stdio: 'ignore' })
        } catch {
          /* 退出路径吞掉:容器可能已经不在了 */
        }
      },
    },
  )
}
