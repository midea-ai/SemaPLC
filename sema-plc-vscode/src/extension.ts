import * as vscode from 'vscode'
import { ServerManager, API_KEY_ENVS } from './server-manager'
import { SemaPanel, resolveWebRoot } from './panel'
import { registerRuntimeCommands } from './runtime-guide'
import { registerMcpProvider } from './mcp-provider'
import { resolveWorkspace } from './workspace'
import { activateStLanguage } from './lang'

let manager: ServerManager | undefined

export function activate(ctx: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel('SemaPLC Server')
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  status.text = '$(circuit-board) SemaPLC'
  status.tooltip = '点击打开 SemaPLC 面板'
  status.command = 'semaplc.open'
  status.show()

  manager = new ServerManager(ctx, out, status)
  ctx.subscriptions.push(out, status)

  const refreshMcp = registerMcpProvider(ctx, () => manager?.currentWorkspace())

  ctx.subscriptions.push(
    vscode.commands.registerCommand('semaplc.open', async () => {
      try {
        // 先校验前端产物再拉 server:反过来的话这里一抛,server 已经起来但没有 panel 去 acquire,
        // 引用计数恒 0 ⇒ release 永不触发,进程空跑到 VSCode 退出为止。
        const webRoot = resolveWebRoot(ctx.extensionPath)
        if (!webRoot) throw new Error('找不到前端产物:既无 media/web,也无 ../sema-plc-web/dist(先 npm run build)')
        const ports = await manager!.start(resolveWorkspace(ctx))
        SemaPanel.show(ctx, ports, manager!, webRoot)
        // 面板刚敲定了工作区,让 MCP 定义跟上 —— 否则 Copilot 那侧还停在上一次算出的路径。
        refreshMcp()
      } catch (e) {
        void vscode.window.showErrorMessage(`SemaPLC 启动失败:${e instanceof Error ? e.message : String(e)}`)
      }
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
