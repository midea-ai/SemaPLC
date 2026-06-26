import { create } from 'zustand'
import type { WsClient } from '../ws/client'
import type { PlcStatus, VariableEntry, VariableValue, RuntimeError } from '../../shared/protocol'

interface PlcStore {
  status: PlcStatus
  variableMap: VariableEntry[]
  values: Record<string, VariableValue>
  runtimeErrors: RuntimeError[]
  /** Names currently force-held by the user (input simulation). */
  forced: Set<string>
  /** Per-variable transient busy flag while a force request is in flight. */
  forcing: Set<string>
  setStatus: (s: PlcStatus) => void
  setVariableMap: (m: VariableEntry[]) => void
  setValues: (v: Record<string, VariableValue>) => void
  setRuntimeErrors: (e: RuntimeError[]) => void
  markForcing: (name: string) => void
  applyForceResult: (forced: string[], released: string[]) => void
  clear: () => void
}

export const usePlcStore = create<PlcStore>((set) => ({
  status: 'EMPTY',
  variableMap: [],
  values: {},
  runtimeErrors: [],
  forced: new Set(),
  forcing: new Set(),
  setStatus: (status) => set({ status }),
  setVariableMap: (variableMap) => set({ variableMap }),
  setValues: (values) => set({ values }),
  setRuntimeErrors: (runtimeErrors) => set({ runtimeErrors }),
  markForcing: (name) => set((s) => ({ forcing: new Set(s.forcing).add(name) })),
  applyForceResult: (forced, released) => set((s) => {
    const nextForced = new Set(s.forced)
    for (const n of forced) nextForced.add(n)
    for (const n of released) nextForced.delete(n)
    const nextForcing = new Set(s.forcing)
    for (const n of [...forced, ...released]) nextForcing.delete(n)
    return { forced: nextForced, forcing: nextForcing }
  }),
  clear: () => set({ status: 'EMPTY', variableMap: [], values: {}, runtimeErrors: [], forced: new Set(), forcing: new Set() }),
}))

export function subscribePlcToWs(client: WsClient) {
  client.on((m) => {
    switch (m.type) {
      case 'plc:state':
        usePlcStore.getState().setStatus(m.status)
        break
      case 'plc:variables':
        usePlcStore.getState().setVariableMap(m.map)
        break
      case 'plc:values':
        usePlcStore.getState().setValues(m.values)
        break
      case 'plc:runtime-error':
        usePlcStore.getState().setRuntimeErrors(m.errors)
        break
      case 'plc:force-result':
        usePlcStore.getState().applyForceResult(m.forced, m.released)
        break
      case 'workspace:switching':
        usePlcStore.getState().clear()
        break
    }
  })
}
