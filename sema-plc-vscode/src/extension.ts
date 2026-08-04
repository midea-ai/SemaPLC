import * as vscode from 'vscode'
import { ServerManager, API_KEY_ENVS } from './server-manager'
import { Bus } from './bus'
import { ChatViewProvider, CHAT_VIEW_ID } from './chat-view'
import { registerRuntimeCommands, knownEngine, resetEngineCache, resolveBin } from './runtime-guide'
import { registerMcpProvider } from './mcp-provider'
import { activateStLanguage } from './lang'

let manager: ServerManager | undefined

export function activate(ctx: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel('SemaPLC Server')
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  status.text = '$(circuit-board) SemaPLC'
  status.tooltip = '点击打开 SemaPLC 对话'
  status.command = 'semaplc.open'
  status.show()

  manager = new ServerManager(ctx, out, status)
  const bus = new Bus(out)
  ctx.subscriptions.push(out, status, { dispose: () => bus.dispose() })

  const refreshMcp = registerMcpProvider(ctx, () => manager?.currentWorkspace())
  // server 就绪后工作区才算敲定,让 MCP 定义跟上 —— 否则 Copilot 那侧还停在上一次算出的路径。
  // 同时把引擎探测结果推给状态条:server 启动时 buildEnv 已 await 过 resolveBin,这里必有值。
  const chat = new ChatViewProvider(ctx, bus, manager, () => {
    refreshMcp()
    const engine = knownEngine()
    bus.setEngine(engine === null ? 'none' : engine ? 'ready' : 'unknown')
  })
  ctx.subscriptions.push({ dispose: () => chat.dispose() })
  bus.onRetryEngine(() => void retryEngine(bus, chat, out))

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, chat, {
      // 折叠辅助侧边栏 / 切到里面别的视图时不销毁 webview。对 WebviewView 适用
      // (Copilot Chat 走的正是这条),省掉一次整页重载 + sticky 重放。
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('semaplc.open', async () => {
      // 聚焦侧栏会触发 resolveWebviewView(首次)——server 的懒启动就挂在那里。
      chat.focus()
      // 已 resolve 的视图不会再 resolve,所以补一次 refresh:server 崩溃换端口后
      // 用户点「重新连接」走的正是这条。refresh 只在端口真变了时才重建 —— 早先这里
      // 写的是无条件 reload,于是每点一次就整页重载一遍,还多挂一份消息订阅。
      await chat.refresh()
    }),
    vscode.commands.registerCommand('semaplc.setApiKey', () => setApiKey(ctx)),
    vscode.commands.registerCommand('semaplc.newSession', () => newSession(bus, manager)),
    vscode.commands.registerCommand('semaplc.settings', () => openSettings(ctx)),
  )

  registerRuntimeCommands(ctx, out)
  // 无条件注册:大纲 / F12 / hover / 补全 / 诊断不能等用户先开面板。共用 out,
  // 免得容器探测日志和降级信息分散在两条流里看不出因果。
  activateStLanguage(ctx, out)
}

export function deactivate(): Thenable<void> | undefined {
  return manager?.stop()
}

/**
 * 状态条上的「重试」。分两步是有意的:重新探测本身零副作用,绝大多数点击发生在用户还没
 * 装好的时候,不该为此重启 server 清掉对话。只有真探到引擎、且 PLC_ENGINE 还停在 none 时
 * 才需要重启 —— 那个值是 spawn 时定死的,不重启 agent 的工具表就不会恢复。
 */
async function retryEngine(bus: Bus, chat: ChatViewProvider, out: vscode.OutputChannel): Promise<void> {
  resetEngineCache()
  bus.setEngine('unknown')
  const bin = await resolveBin(out)
  if (!bin) {
    bus.setEngine('none')
    void vscode.window.showInformationMessage('SemaPLC:仍未检测到 Docker / Podman。装好并启动后再试。')
    return
  }
  const ok = await vscode.window.showInformationMessage(
    `SemaPLC:已检测到 ${bin}。需要重启本地服务才能启用编译与运行,当前对话会清空。`,
    { modal: true },
    '重启并启用',
  )
  // 拒绝时状态条必须留在 none:server 里的 PLC_ENGINE 确实还是 none,工具表没恢复,
  // 这时候显示"已就绪"就是骗人 —— 用户会去点编译,然后发现工具根本不存在。
  if (!ok) {
    bus.setEngine('none')
    return
  }
  bus.setEngine('ready')
  await manager?.stop()
  await chat.refresh()
}

/**
 * 标题栏那颗 `+`。session:reset 不只是「开一段新对话」—— server 侧会 cleanWorkspace(),
 * 把工作区目录下的文件删干净再从模板重建。所以路径必须进确认框:只说「新会话」,用户
 * 没法判断自己点的是不是删库(web 版顶栏那颗「重置」同理)。
 */
async function newSession(bus: Bus, mgr: ServerManager | undefined): Promise<void> {
  const ws = mgr?.currentWorkspace()
  const ok = await vscode.window.showWarningMessage(
    '开始新会话?当前对话会清空,工作区目录下的全部内容将被永久删除(不进回收站)。',
    { modal: true, detail: ws ?? '(工作区尚未就绪)' },
    '新会话',
  )
  if (ok) bus.send({ type: 'session:reset' })
}

/** 标题栏那颗 ⚙。API Key 存在 secrets 里,设置页看不到它,所以两条路都摆出来。 */
async function openSettings(ctx: vscode.ExtensionContext): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: '$(key) 设置 LLM API Key', key: 'apiKey' },
      { label: '$(settings-gear) 打开插件设置', key: 'settings' },
    ],
    { placeHolder: 'SemaPLC 设置' },
  )
  if (pick?.key === 'apiKey') await setApiKey(ctx)
  else if (pick?.key === 'settings') await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:semaplc.semaplc')
}

async function setApiKey(ctx: vscode.ExtensionContext): Promise<void> {
  const items = await Promise.all(
    API_KEY_ENVS.map(async (name) => ({
      label: name,
      description: (await ctx.secrets.get(name)) ? '已设置' : undefined,
    })),
  )
  const pick = await vscode.window.showQuickPick(items, { placeHolder: '选择要设置的 LLM API Key' })
  if (!pick) return
  const value = await vscode.window.showInputBox({
    prompt: `输入 ${pick.label}(留空则删除已存的 key)`,
    password: true,
    ignoreFocusOut: true,
  })
  if (value === undefined) return
  if (value.trim() === '') {
    await ctx.secrets.delete(pick.label)
    void vscode.window.showInformationMessage(`已删除 ${pick.label}`)
    return
  }
  await ctx.secrets.store(pick.label, value.trim())
  void vscode.window.showInformationMessage(`已保存 ${pick.label}(重新打开 SemaPLC 面板后生效)`)
}
