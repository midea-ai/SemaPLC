import { getWsClient, type WsClientLike } from '../ws/client'
import { subscribeAgentToWs } from './agent'
import { subscribePlcToWs } from './plc'
import { subscribeEditorToWs } from './editor'
import { subscribeWorkspaceToWs } from './workspace'
import { subscribeLogsToWs } from './logs'
import { subscribeSimToWs } from './sim'
import { subscribeModelToWs } from './model'

const SUBSCRIBERS = {
  agent: subscribeAgentToWs,
  plc: subscribePlcToWs,
  editor: subscribeEditorToWs,
  workspace: subscribeWorkspaceToWs,
  logs: subscribeLogsToWs,
  sim: subscribeSimToWs,
  model: subscribeModelToWs,
} as const

export type StoreName = keyof typeof SUBSCRIBERS

let wired = false

/**
 * 按需订阅。VSCode 的对话侧边栏只要 agent + model —— 全订的话侧栏还要跑 editor / plc /
 * sim 三份用不上的 store 更新,其中 editor 每秒收一次全文重发(sema-bridge 的 rescanAndEmit)。
 */
export function wireStores(client: WsClientLike, names: readonly StoreName[]): void {
  if (wired) return
  for (const n of names) SUBSCRIBERS[n](client)
  wired = true
}

/** web 版:整页都在,七个 store 全订。 */
export function wireStoresToWs(): void {
  wireStores(getWsClient(), Object.keys(SUBSCRIBERS) as StoreName[])
}
