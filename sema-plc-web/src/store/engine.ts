import { create } from 'zustand'
// vscodeApi 的模块级单例住在 confirmDialog.ts（acquireVsCodeApi() 全局只能调一次）。
import { vscodeApi } from '../lib/confirmDialog'

/** 与 sema-plc-vscode/src/bus.ts 的 EngineStatus 一一对应,改一边必须改另一边。 */
export type EngineStatus = 'unknown' | 'ready' | 'none'

/**
 * 容器引擎(Docker / Podman)可用性。信息源是扩展宿主的探测,经 bus 的 engine:status 信封推来。
 *
 * 浏览器版永远收不到这条消息,状态停在 'unknown' —— 状态条据此不渲染。不给 web 版做等价
 * 探测是有意的:那边 server 跑在同一台机器上,真缺 docker 时用户就在终端前面,看得见报错。
 */
export const useEngineStore = create<{ status: EngineStatus }>(() => ({ status: 'unknown' }))

if (typeof window !== 'undefined') {
  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data
    if (d && typeof d === 'object' && d.type === 'engine:status') {
      useEngineStore.setState({ status: d.status as EngineStatus })
    }
  })
}

/** 「重试」→ 扩展重新探测(见 extension.ts 的 retryEngine)。web 版下是空操作。 */
export function retryEngine(): void {
  vscodeApi()?.postMessage({ type: 'engine:retry' })
}

/** 「去配置」→ 扩展执行 semaplc.setApiKey。侧边栏没有 TopBar 的 ModelPanel,这是唯一入口。 */
export function configureModel(): void {
  vscodeApi()?.postMessage({ type: 'model:configure' })
}
