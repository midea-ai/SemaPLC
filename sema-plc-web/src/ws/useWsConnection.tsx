import { useEffect, useState } from 'react'
import { getWsClient, type WsStatus } from './client'

export function useWsConnection() {
  // Lazy-init to current WS status so components that mount AFTER the WS already
  // opened don't show 'connecting' until the next status change. Mounting via tab
  // switches in RightPanel would otherwise stay stuck.
  const [status, setStatus] = useState<WsStatus>(() => {
    try { return getWsClient().getStatus() } catch { return 'connecting' }
  })

  useEffect(() => {
    const client = getWsClient()
    // Re-sync in case status changed between lazy-init and effect attach.
    setStatus(client.getStatus())
    return client.onStatus(setStatus)
  }, [])

  return {
    status,
    send: (m: import('../../shared/protocol').ClientMessage) => getWsClient().send(m),
  }
}
