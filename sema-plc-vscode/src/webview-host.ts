import * as vscode from 'vscode'
import * as fs from 'fs'
import * as path from 'path'

/** 前端产物目录:优先 VSIX 内 media/web,开发时回退 ../sema-plc-web/dist。 */
export function resolveWebRoot(extensionPath: string): string | undefined {
  return [path.join(extensionPath, 'media', 'web'), path.join(extensionPath, '..', 'sema-plc-web', 'dist')].find((p) =>
    fs.existsSync(path.join(p, 'index.html')),
  )
}

// resolveWorkspaceFile 随整合面板一起删了:它守的是「webview 里的文件树让扩展 openTextDocument」
// 这条路径,而侧边栏只有对话,文件树的活由 Explorer 接走了 —— 没有 webview 再报路径上来。
// 第 4 步的梯形图预览若要「点 rung 跳源码」,那是扩展自己已知的 uri,不经这条外部输入。

/**
 * 读入口 HTML:资源路径重写为 webview URI,注入 CSP 与 nonce。
 *
 * 与整合面板时期相比 CSP 去掉了 connect-src —— hub 模式下 webview 不再自己连 WS 或打
 * /api,收发全走 postMessage,于是这里可以是真正的零网络出口。将来若有入口需要直连
 * (例如要 fetch /api/check 的梯形图预览),那条 connect-src 应该按入口单独放开,
 * 而不是在这里对所有 webview 统一开口。
 */
export function buildWebviewHtml(webview: vscode.Webview, webRoot: string, htmlFile: string): string {
  const raw = fs.readFileSync(path.join(webRoot, htmlFile), 'utf8')

  const rewritten = raw.replace(/\b(src|href)="([^"]+)"/g, (whole, attr: string, url: string) => {
    if (/^(https?:|data:|blob:|vscode-|#|\/\/)/.test(url)) return whole
    const rel = url.replace(/^\.?\//, '')
    const uri = webview.asWebviewUri(vscode.Uri.file(path.join(webRoot, rel)))
    return `${attr}="${uri}"`
  })

  // 不再需要 nonce:整合面板时期那条 nonce 是给注入的 inline `window.__SEMAPLC__=…`
  // 用的,而 hub 模式下端口不必再进 webview(收发走 postMessage),注入整个消失。
  // vite 产物只有 <script type="module" src=…> 这一种外部脚本,cspSource 覆盖得到。
  const csp = [
    "default-src 'none'",
    `script-src ${webview.cspSource}`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
  ].join('; ')

  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  return rewritten.includes('<head>') ? rewritten.replace('<head>', `<head>${meta}`) : meta + rewritten
}
