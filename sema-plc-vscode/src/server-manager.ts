import * as vscode from 'vscode'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import { spawn, ChildProcess } from 'child_process'
import { resolveWorkspace } from './workspace'
import { resolveBin } from './runtime-guide'
import { loadEnvFile, resolveEnvPath } from './env-file'

/** 各 LLM provider 的 key 环境变量名(与 sema-plc-web/server/model-registry.ts 的 ENV_HINTS 保持一致)。 */
export const API_KEY_ENVS = [
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
  'MINIMAX_API_KEY',
  'DOUBAO_API_KEY',
  'QWEN_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'KIMI_API_KEY',
  'ZAI_API_KEY',
  'BIGMODEL_API_KEY',
  'SILICONFLOW_API_KEY',
  'PLC_OPENAI_COMPATIBLE_API_KEY',
]

export interface ServerPorts {
  httpPort: number
  wsPort: number
}

/** 一次性占住两个端口再全部释放,保证 http/ws 互不相同。 */
async function freePorts(): Promise<ServerPorts> {
  const servers = await Promise.all(
    Array.from({ length: 2 }, () =>
      new Promise<net.Server>((resolve, reject) => {
        const srv = net.createServer()
        srv.once('error', reject)
        srv.listen(0, '127.0.0.1', () => resolve(srv))
      }),
    ),
  )
  const [httpPort, wsPort] = servers.map((s) => (s.address() as net.AddressInfo).port)
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))))
  return { httpPort, wsPort }
}

function firstExisting(...candidates: string[]): string | undefined {
  return candidates.find((p) => fs.existsSync(p))
}

export class ServerManager {
  private proc: ChildProcess | undefined
  private ports: ServerPorts | undefined
  private starting: Promise<ServerPorts> | undefined
  private autoRestarted = false
  private workspaceDir: string | undefined

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly out: vscode.OutputChannel,
    private readonly status: vscode.StatusBarItem,
  ) {}

  /** server 正在服务的工作区;没在跑则 undefined。 */
  currentWorkspace(): string | undefined {
    return this.ports && this.proc && this.proc.exitCode === null ? this.workspaceDir : undefined
  }

  /** 启动 server 子进程(已在跑则直接复用),返回 http/ws 端口。reuse:自动重启时沿用原端口。 */
  start(workspaceDir: string, reuse?: ServerPorts): Promise<ServerPorts> {
    if (this.ports && this.proc && this.proc.exitCode === null) {
      if (this.workspaceDir === workspaceDir) return Promise.resolve(this.ports)
      // 工作区变了(用户改了 semaplc.workspace 或换了文件夹)。直接复用等于让 server 永远
      // 停在旧目录,而 MCP env 已经指向新目录 —— 又是两份 state。停掉重来;不复用端口,
      // 让 SemaPanel.sync() 按新端口重建 webview(工作区都换了,前端本来就该重载)。
      return this.stop().then(() => this.start(workspaceDir))
    }
    if (this.starting) return this.starting
    this.starting = this.doStart(workspaceDir, reuse).finally(() => {
      this.starting = undefined
    })
    return this.starting
  }

  /**
   * 懒启动:已在跑就复用,没跑就按 resolveWorkspace 算出的工作区拉起来。
   *
   * 整合面板时期 server 的生死挂在 panel 的引用计数上(acquire/release),面板一下线
   * 就没有任何人负责它了 —— 侧边栏是 WebviewView,折叠时并不销毁,用引用计数反而会
   * 在折叠/展开之间反复重启 server。现在改成:谁需要谁 ensure,一直活到 deactivate。
   *
   * 不能改成激活即启动:activationEvents 里有 onStartupFinished,那样装了插件的每个
   * 窗口一开就 spawn 一个 node server 并开始打 PLC 的 REST 口。
   */
  ensureServer(): Promise<ServerPorts> {
    return this.start(resolveWorkspace(this.ctx))
  }

  async stop(): Promise<void> {
    const proc = this.proc
    // 先摘引用:killTree 触发的 exit 回调靠 `this.proc !== proc` 判断自己已过期,不会误报异常退出。
    this.proc = undefined
    this.ports = undefined
    this.autoRestarted = false
    if (!proc) return
    await this.killTree(proc)
    this.setStatus('idle')
  }

  /** SIGTERM,3s 不退再 SIGKILL。调用前务必先摘掉 this.proc。 */
  private async killTree(proc: ChildProcess): Promise<void> {
    if (proc.exitCode !== null || proc.pid === undefined) return
    const pid = proc.pid
    try {
      // detached spawn ⇒ 自成进程组,负 pid 连带回收 sema-core spawn 的 MCP 孙进程
      process.kill(-pid, 'SIGTERM')
    } catch {
      /* 已退出 */
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* 已退出 */
        }
        resolve()
      }, 3000)
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  private async doStart(workspaceDir: string, reuse?: ServerPorts): Promise<ServerPorts> {
    const entry = firstExisting(
      path.join(this.ctx.extensionPath, 'vendor', 'server', 'server.bundle.mjs'),
      // monorepo 开发路径(扩展根 = sema-plc-vscode)
      path.join(this.ctx.extensionPath, '..', 'sema-plc-web', 'dist-server', 'server', 'index.js'),
      path.join(this.ctx.extensionPath, '..', 'sema-plc-web', 'dist-server', 'index.js'),
    )
    if (!entry) {
      this.setStatus('error')
      throw new Error('找不到 server 入口:既无 vendor/server/server.bundle.mjs,也无 ../sema-plc-web/dist-server(先 npm run build)')
    }

    // 自动重启必须沿用原端口:webview 里的 __SEMAPLC__ 是打开面板时写死的,换端口 = 前端永远连不回来。
    const ports = reuse ?? (await freePorts())
    const { httpPort, wsPort } = ports
    const env = await this.buildEnv(httpPort, wsPort)

    this.out.appendLine(`[server] ${entry} --workspace ${workspaceDir} (http=${httpPort} ws=${wsPort})`)
    const proc = spawn(process.execPath, [entry, '--workspace', workspaceDir], {
      cwd: path.dirname(entry),
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.proc = proc
    this.setStatus('starting')

    proc.stdout?.on('data', (d: Buffer) => this.out.append(d.toString()))
    proc.stderr?.on('data', (d: Buffer) => this.out.append(d.toString()))
    proc.on('exit', (code, signal) => this.onExit(proc, workspaceDir, ports, code, signal))

    try {
      await this.waitHealthy(httpPort, proc)
    } catch (e) {
      // 超时的进程往往还活着:不收掉就是孤儿(detached),还会占着 workspace 与端口。
      if (this.proc === proc) this.proc = undefined
      await this.killTree(proc)
      this.setStatus('error')
      this.out.show(true)
      throw e
    }
    this.ports = ports
    this.workspaceDir = workspaceDir
    this.setStatus('ready')
    return ports
  }

  private async buildEnv(httpPort: number, wsPort: number): Promise<NodeJS.ProcessEnv> {
    const cfg = vscode.workspace.getConfiguration('semaplc')
    const plcToolsDist = firstExisting(
      path.join(this.ctx.extensionPath, 'vendor', 'plc-tools', 'dist'),
      path.join(this.ctx.extensionPath, '..', 'sema-plc-tools', 'dist'),
    )
    // semaplc.envFile:指一个 .env 过来,把里面的 *_API_KEY / PLC_* 注入 server 进程。
    // 排在 process.env 之后 = 显式配置压过从 VSCode 进程继承来的 shell 环境;排在下面
    // 那几行之前 = 扩展自己算出来的端口/工作区永远说了算(parseEnvFile 里还拦了一道)。
    const envFile = cfg.get<string>('envFile')?.trim()
    const fromFile = envFile
      ? loadEnvFile(
          resolveEnvPath(envFile, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath),
          (m) => this.out.appendLine(m),
        )
      : {}
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...fromFile,
      PORT: String(httpPort),
      WS_PORT: String(wsPort),
      SEMAPLC_DATA_DIR: this.ctx.globalStorageUri.fsPath,
      PLC_CONTAINER: cfg.get<string>('container.name') || 'openplc-plc-dev',
      PLC_URL: cfg.get<string>('plcUrl') || 'https://localhost:8443',
    }
    if (plcToolsDist) env.PLC_TOOLS_DIST = plcToolsDist
    // semaplc.model 的默认值是 'deepseek',cfg.get 分不出「用户选了 deepseek」和「没动过」。
    // 不用 inspect 区分的话,.env 里写着 PLC_MODEL=bigmodel 也会被这个默认值顶掉 ——
    // 用户配好了 key 却发现跑的还是那个没配的模型。只有显式设过才覆盖 .env。
    const mi = cfg.inspect<string>('model')
    const explicitModel = mi?.workspaceFolderValue ?? mi?.workspaceValue ?? mi?.globalValue
    if (explicitModel) env.PLC_MODEL = explicitModel
    else if (!env.PLC_MODEL) env.PLC_MODEL = cfg.get<string>('model') || 'deepseek'
    const dockerBin = cfg.get<string>('container.bin')
    if (dockerBin) env.PLC_DOCKER_BIN = dockerBin
    // 无引擎时把编译/运行类工具从 agent 的 MCP 工具表里摘掉(plc-tools 侧 OFFLINE_TOOLS)。
    // 不摘的话 agent 会照常调 plc_compile,把 "docker not found" 当成自己代码写错去改 ST。
    // 只探测不引导:激活路径不该弹模态框,更不该 start/build 容器。
    env.PLC_ENGINE = (await resolveBin(this.out)) ?? 'none'
    // SecretStorage 里已存的 key。放在最后 = 压过 envFile:两处都配过时,以用户在插件里
    // 显式填的那个为准。(server 侧**不**读任何 .env —— 它没有 dotenv,别指望那条路。)
    for (const name of API_KEY_ENVS) {
      const v = await this.ctx.secrets.get(name)
      if (v) env[name] = v
    }
    await fs.promises.mkdir(this.ctx.globalStorageUri.fsPath, { recursive: true })
    return env
  }

  /** 轮询 /api/health,15s 超时。 */
  private async waitHealthy(httpPort: number, proc: ChildProcess): Promise<void> {
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`server 启动即退出(code=${proc.exitCode}),详见输出面板`)
      try {
        // 必须带超时:server 若接受了连接却不回应,无 signal 的 fetch 会挂到 undici 默认上限(分钟级),
        // 循环卡死在这一次 await 上,下面的 deadline 根本轮不到检查。
        const res = await fetch(`http://127.0.0.1:${httpPort}/api/health`, { signal: AbortSignal.timeout(2000) })
        if (res.ok) return
      } catch {
        /* 还没起来 */
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error('server 15s 内未就绪,详见输出面板「SemaPLC Server」')
  }

  private onExit(
    proc: ChildProcess,
    workspaceDir: string,
    ports: ServerPorts,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    // 迟到的 exit:this.proc 已经指向别的进程(或已被 stop/启动失败摘掉)。
    // 少了这道守卫,旧进程退出会把正在服务的新进程状态清空,panel 还连着它却显示"没在跑"。
    if (this.proc !== proc) return
    this.proc = undefined
    this.ports = undefined
    this.out.appendLine(`[server] 退出 code=${code} signal=${signal}`)
    if (code === 0 || signal === 'SIGTERM') {
      this.setStatus('idle')
      return
    }
    this.setStatus('error')
    // 沿用原端口重启:bus 的重连会自己接上去,webview 不必重建(它压根不知道端口)。
    if (!this.autoRestarted) {
      this.autoRestarted = true
      this.out.appendLine('[server] 异常退出,自动重启一次(沿用原端口)…')
      void this.start(workspaceDir, ports).catch(() => undefined)
      return
    }
    void vscode.window
      .showErrorMessage('SemaPLC server 异常退出。', '查看日志', '重新连接')
      .then((pick) => {
        if (pick === '查看日志') this.out.show(true)
        // semaplc.open 会 ensureServer + 重建侧边栏(端口可能已经换了一对)
        else if (pick === '重新连接') void vscode.commands.executeCommand('semaplc.open')
      })
  }

  private setStatus(state: 'idle' | 'starting' | 'ready' | 'error'): void {
    const text = {
      idle: '$(circuit-board) SemaPLC',
      starting: '$(sync~spin) SemaPLC 启动中',
      ready: '$(circuit-board) SemaPLC',
      error: '$(error) SemaPLC',
    }[state]
    this.status.text = text
    this.status.tooltip = { idle: '点击打开 SemaPLC 面板', starting: 'server 启动中…', ready: 'server 运行中', error: 'server 异常,点击重试' }[state]
    this.status.backgroundColor = state === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined
  }
}
