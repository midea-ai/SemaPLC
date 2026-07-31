import { create } from 'zustand'
import type { ModelConfigState } from '../../shared/protocol'
import type { WsClientLike } from '../ws/client'

interface ModelStore extends Omit<ModelConfigState, 'thinking'> {
  thinking: boolean | null
  setConfig: (config: ModelConfigState) => void
}

export const useModelStore = create<ModelStore>((set) => ({
  selected: null,
  active: null,
  options: [],
  thinking: null as boolean | null,
  setConfig: (config) => set(config),
}))

export function subscribeModelToWs(client: WsClientLike) {
  client.on((m) => {
    if (m.type === 'model:config') useModelStore.getState().setConfig(m.config)
  })
}
