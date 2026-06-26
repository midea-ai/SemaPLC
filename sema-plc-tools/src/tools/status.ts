import { RuntimeClient } from '../client/runtime.js'
import type { StatusResult } from '../types.js'

export async function handleStatus(client: RuntimeClient): Promise<StatusResult> {
  try {
    const status = await client.getStatus()
    return { status, isRunning: status === 'RUNNING', runtimeReachable: true }
  } catch {
    return { status: 'ERROR', isRunning: false, runtimeReachable: false }
  }
}
