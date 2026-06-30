import { getWsClient } from '../ws/client'
import { subscribeAgentToWs } from './agent'
import { subscribePlcToWs } from './plc'
import { subscribeEditorToWs } from './editor'
import { subscribeWorkspaceToWs } from './workspace'
import { subscribeLogsToWs } from './logs'
import { subscribeSimToWs } from './sim'
import { subscribeModelToWs } from './model'

let wired = false

export function wireStoresToWs(): void {
  if (wired) return
  const client = getWsClient()
  subscribeAgentToWs(client)
  subscribePlcToWs(client)
  subscribeEditorToWs(client)
  subscribeWorkspaceToWs(client)
  subscribeLogsToWs(client)
  subscribeSimToWs(client)
  subscribeModelToWs(client)
  wired = true
}
