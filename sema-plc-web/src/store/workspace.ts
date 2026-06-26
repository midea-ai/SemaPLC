import { create } from 'zustand'
import type { WsClient } from '../ws/client'

interface WorkspaceStore {
  path: string | null
  sessionId: string | null
  switching: boolean
  setReady: (path: string, sessionId: string) => void
  setSwitching: () => void
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  path: null,
  sessionId: null,
  switching: false,
  setReady: (path, sessionId) => set({ path, sessionId, switching: false }),
  setSwitching: () => set({ switching: true }),
}))

export function subscribeWorkspaceToWs(client: WsClient) {
  client.on((m) => {
    switch (m.type) {
      case 'workspace:ready':
        useWorkspaceStore.getState().setReady(m.path, m.sessionId)
        break
      case 'workspace:switching':
        useWorkspaceStore.getState().setSwitching()
        break
    }
  })
}
