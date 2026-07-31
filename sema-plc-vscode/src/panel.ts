import * as vscode from 'vscode'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type { ServerManager, ServerPorts } from './server-manager'

/** 前端产物目录:优先 VSIX 内 media/web,开发时回退 ../sema-plc-web/dist。 */
export function resolveWebRoot(extensionPath: string): string | undefined {
  return [path.join(extensionPath, 'media', 'web'), path.join(extensionPath, '..', 'sema-plc-web', 'dist')].find((p) =>
    fs.existsSync(path.join(p, 'index.html')),
  )
}

export class SemaPanel {
  private static current: SemaPanel | undefined

  /** webRoot 由调用方在 start server 之前先解析好 —— 这里再失败就得回收已启动的 server。 */
  static show(ctx: vscode.ExtensionContext, ports: ServerPorts, manager: ServerManager, webRoot: string): SemaPanel {
    if (SemaPanel.current) {
      SemaPanel.current.sync(ports)
      SemaPanel.current.panel.reveal()
      return SemaPanel.current
    }
    const panel = vscode.window.createWebviewPanel('semaplc.panel', 'SemaPLC', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(webRoot)],
    })
    SemaPanel.current = new SemaPanel(panel, webRoot, ports, manager)
    return SemaPanel.current
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly webRoot: string,
    private ports: ServerPorts,
    manager: ServerManager,
  ) {
    // buildHtml 会 readFileSync index.html,产物被重建时可能 ENOENT。它必须排在 acquire()
    // 之前:抛在 acquire 之后的话引用计数永久 +1(release 再也回不到 0 ⇒ server 撑到
    // VSCode 退出),而且 onDidDispose 还没注册、SemaPanel.current 也还没赋值,
    // 面板会变成关不掉也复用不了的孤儿。
    const html = buildHtml(panel.webview, webRoot, ports)
    manager.acquire()
    panel.webview.html = html
    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'semaplc:open-file') {
        // 越界 / server 已退出 ⇒ 静默丢弃:这条消息由 webview 里的 JS 发出,拒绝理由回给它
        // 等于送探测者一个反馈信道,而正常路径下那份文件树本来就是同一个工作区列出来的。
        const abs = resolveWorkspaceFile(manager.currentWorkspace(), msg.path)
        if (!abs) return
        try {
          // 开在面板右边一列而不是默认列:面板占着当前编辑器组,开在同一组里会把面板顶成后台 tab ——
          // 用户点的是面板里的文件树,不该因此看不见面板。
          //
          // 用「面板所在列 +1」这个定值,而不是 ViewColumn.Beside:Beside 按**调用那一刻的活动列**算,
          // 而双击文件树会在 ~150ms 内发两条消息,两个 async handler 并发 —— 第二条算 Beside 时
          // 焦点已经落在第一条开出的组上,于是再劈一个组。实测双击一个文件会开出 2 个 tab、3 个编辑器组。
          const column = panel.viewColumn ? panel.viewColumn + 1 : vscode.ViewColumn.Beside
          await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(abs)), column)
        } catch (e) {
          // 文件在列表刷新之后被删/被改权限时会走到这里,静默失败等于点了没反应
          void vscode.window.showErrorMessage(`打开失败:${e instanceof Error ? e.message : String(e)}`)
        }
        return
      }
      if (msg?.type !== 'semaplc:confirm') return
      const pick = await vscode.window.showWarningMessage(String(msg.message ?? ''), { modal: true }, '确定')
      void panel.webview.postMessage({ type: 'semaplc:confirm-result', id: msg.id, ok: pick === '确定' })
    })
    panel.onDidDispose(() => {
      SemaPanel.current = undefined
      manager.release()
    })
  }

  /**
   * server 换了端口(崩溃后手动「重新打开面板」会抢一对新端口)时重建 HTML。
   * __SEMAPLC__ 是构建 HTML 时注入进去写死的,不重建的话 webview 还连着已经消失的
   * 旧端口,界面永远停在"已断开"——恰恰是给用户的那个恢复按钮恢复不了。
   * 端口没变则什么都不做,避免无谓的 webview 重载丢掉前端状态。
   */
  private sync(ports: ServerPorts): void {
    if (ports.httpPort === this.ports.httpPort && ports.wsPort === this.ports.wsPort) return
    // 先 buildHtml 再记账:反过来的话 readFileSync 一 ENOENT,this.ports 已经是新端口而
    // webview 还挂在旧端口上,后续每次 sync 都被上面那行判等提前 return —— 永远修不回来。
    const html = buildHtml(this.panel.webview, this.webRoot, ports)
    this.panel.webview.html = html
    this.ports = ports
  }
}

/**
 * 把 webview 报上来的路径钉死在工作区内,返回可以交给 openTextDocument 的绝对路径;
 * 任何一项不满足都返回 undefined(调用方据此丢弃这条消息)。
 *
 * 不能直接 path.join 就用:webview 里跑的是前端产物及其整条依赖链,任何一环被投毒都能
 * 发一条 `../../.ssh/id_rsa` 让扩展替它打开——webview 消息是外部输入,不是自己人。
 * 相对基准取 server 正在服务的工作区:前端那份文件树就是 server 用 path.relative(workspace, …)
 * 列出来的,两边必须同一个根,否则合法路径也会解析到别处。
 */
export function resolveWorkspaceFile(workspace: string | undefined, p: unknown): string | undefined {
  // NUL 截断:'a.st\0../../etc/passwd' 在校验时看着是 a.st,到了系统调用只剩前半段。
  if (!workspace || typeof p !== 'string' || !p || p.includes('\0')) return undefined
  const root = path.resolve(workspace)
  const abs = path.resolve(root, p)
  // 前缀必须带分隔符:否则 /ws-backup/x.st 会被 /ws 放行。
  return abs.startsWith(root + path.sep) ? abs : undefined
}

/** 读 index.html:资源路径重写为 webview URI,注入 CSP 与 window.__SEMAPLC__。 */
function buildHtml(webview: vscode.Webview, webRoot: string, ports: ServerPorts): string {
  const raw = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')
  const nonce = crypto.randomBytes(16).toString('base64')

  const rewritten = raw.replace(/\b(src|href)="([^"]+)"/g, (whole, attr: string, url: string) => {
    if (/^(https?:|data:|blob:|vscode-|#|\/\/)/.test(url)) return whole
    const rel = url.replace(/^\.?\//, '')
    const uri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, rel)))
    return `${attr}="${uri}"`
  })

  const csp = [
    "default-src 'none'",
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    'connect-src ws://127.0.0.1:* http://127.0.0.1:*',
  ].join('; ')

  const injected =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<script nonce="${nonce}">window.__SEMAPLC__={wsUrl:"ws://127.0.0.1:${ports.wsPort}",httpBase:"http://127.0.0.1:${ports.httpPort}"};</script>`

  return rewritten.includes('<head>') ? rewritten.replace('<head>', `<head>${injected}`) : injected + rewritten
}
