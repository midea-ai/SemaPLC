// VSCode webview 宿主注入的全局(web 版不存在,故全部可选)
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void }

interface Window {
  __SEMAPLC__?: { wsUrl: string; httpBase: string }
}
