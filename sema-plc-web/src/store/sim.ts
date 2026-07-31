import { create } from 'zustand'
import type { WsClientLike } from '../ws/client'
import type { SceneSpec } from '../../shared/protocol'

interface SimStore {
  scene: SceneSpec | null
  sceneErrors: string[]
  sceneWarnings: string[]
  setScene: (s: SceneSpec, errors?: string[], warnings?: string[]) => void
  clear: () => void
}

export const useSimStore = create<SimStore>((set) => ({
  scene: null,
  sceneErrors: [],
  sceneWarnings: [],
  setScene: (scene, errors = [], warnings = []) => set({ scene, sceneErrors: errors, sceneWarnings: warnings }),
  clear: () => set({ scene: null, sceneErrors: [], sceneWarnings: [] }),
}))

export function subscribeSimToWs(client: WsClientLike) {
  client.on((m) => {
    switch (m.type) {
      case 'scene:ready':
        useSimStore.getState().setScene(m.scene, m.sceneErrors, m.sceneWarnings)
        break
      case 'workspace:switching':
        useSimStore.getState().clear()
        break
    }
  })
}
