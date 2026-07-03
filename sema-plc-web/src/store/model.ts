import { create } from 'zustand'
import type { ModelConfigState } from '../../shared/protocol'
import type { WsClient } from '../ws/client'

interface ModelStore extends ModelConfigState {
  setConfig: (config: ModelConfigState) => void
}

export const useModelStore = create<ModelStore>((set) => ({
  selected: null,
  active: null,
  options: [],
  setConfig: (config) => set(config),
}))

export function subscribeModelToWs(client: WsClient) {
  client.on((m) => {
    if (m.type === 'model:config') useModelStore.getState().setConfig(m.config)
  })
}
