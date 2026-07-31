import * as vscode from 'vscode'
import type { Bus } from './bus'
import type { ServerManager } from './server-manager'
import { buildWebviewHtml, resolveWebRoot } from './webview-host'

export const CHAT_VIEW_ID = 'semaplc.chat'

/**
 * 活动栏里的对话侧边栏。
 *
 * 它同时是 server 的懒启动触发点:视图被 resolve 意味着用户打开过这个侧栏(VSCode 只
 * 恢复用户主动打开过的视图),而扩展激活本身不该碰 server —— 否则装了插件的每个窗口
 * 一开就 spawn 一个 node 进程。工作区污染那一档由 workspace.ts 负责:它绝不会把用户
 * 的普通代码仓库当成工作区,而是回落到扩展专属目录。
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly bus: Bus,
    private readonly manager: ServerManager,
    private readonly onServerReady: () => void,
  ) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view
    const webRoot = resolveWebRoot(this.ctx.extensionPath)
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: webRoot ? [vscode.Uri.file(webRoot)] : [],
    }
    // retainContextWhenHidden 不在这儿设 —— 对 WebviewView 它是 registerWebviewViewProvider
    // 的 webviewOptions 参数,见 extension.ts。写在 webview.options 上是无声无息的空操作。
    if (!webRoot) {
      view.webview.html = placeholder('找不到前端产物', '既无 media/web,也无 ../sema-plc-web/dist —— 先 npm run build。')
      return
    }

    view.webview.html = placeholder('SemaPLC', '正在启动本地 server…')
    try {
      const ports = await this.manager.ensureServer()
      this.bus.connect(ports.wsPort)
      // html 一赋值 webview 就从头加载,随后它自己发 view:ready,重放由那里触发。
      view.webview.html = buildWebviewHtml(view.webview, webRoot, 'chat.html')
      this.ctx.subscriptions.push(this.bus.attach('chat', view.webview))
      this.onServerReady()
    } catch (e) {
      view.webview.html = placeholder('启动失败', e instanceof Error ? e.message : String(e))
    }
  }

  /** server 换了端口(崩溃后重启会抢新端口)⇒ 重新 resolve 一次,让 bus 改连新端口。 */
  reload(): void {
    if (this.view) void this.resolveWebviewView(this.view)
  }

  focus(): void {
    void vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}

/** 占位页:server 起来之前和失败时都用它,免得用户对着白板猜。两个参数都在这里转义 —— body 常带 server 的报错原文。 */
function placeholder(title: string, body: string): string {
  return (
    `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">` +
    `<style>body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:12px}` +
    `h3{margin:0 0 6px;font-size:13px}p{margin:0;color:var(--vscode-descriptionForeground);line-height:1.5}</style>` +
    `<h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>`
  )
}
