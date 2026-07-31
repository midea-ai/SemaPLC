import * as vscode from 'vscode'
import { ServerManager, API_KEY_ENVS } from './server-manager'
import { Bus } from './bus'
import { ChatViewProvider, CHAT_VIEW_ID } from './chat-view'
import { registerRuntimeCommands } from './runtime-guide'
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
  const chat = new ChatViewProvider(ctx, bus, manager, refreshMcp)
  ctx.subscriptions.push({ dispose: () => chat.dispose() })

  ctx.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, chat, {
      // 折叠侧栏 / 切到别的活动栏图标时不销毁 webview。对 WebviewView 适用
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
  )

  registerRuntimeCommands(ctx, out)
  // 无条件注册:大纲 / F12 / hover / 补全 / 诊断不能等用户先开面板。共用 out,
  // 免得容器探测日志和降级信息分散在两条流里看不出因果。
  activateStLanguage(ctx, out)
}

export function deactivate(): Thenable<void> | undefined {
  return manager?.stop()
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
