// 确认框:webview 里 window.confirm 被禁用,改由扩展弹 showWarningMessage(modal);web 版回退原生 confirm。
// acquireVsCodeApi 全局只能调用一次 → 模块级单例。导出是因为往扩展发消息的不止确认框
// (CodeView 还要发 semaplc:open-file):各自 acquire 一次,第二个调用方会直接抛。
let api: { postMessage(msg: unknown): void } | null | undefined
export const vscodeApi = () => (api === undefined ? (api = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null) : api)

let seq = 0

export async function confirmDialog(message: string): Promise<boolean> {
  const vs = vscodeApi()
  if (!vs) return window.confirm(message)
  const id = ++seq
  return new Promise<boolean>((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      resolve(ok)
    }
    const onMessage = (e: MessageEvent) => {
      const d = e.data
      if (d && d.type === 'semaplc:confirm-result' && d.id === id) done(!!d.ok)
    }
    // 扩展侧异常/丢消息时不要永久挂着,超时按"取消"处理
    const timer = setTimeout(() => done(false), 60_000)
    window.addEventListener('message', onMessage)
    vs.postMessage({ type: 'semaplc:confirm', id, message })
  })
}
