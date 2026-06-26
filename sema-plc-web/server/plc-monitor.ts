import { bus } from './event-bus.js'
import { readPlcState, plcStateFileForWorkspace } from './state-reader.js'
import type { PlcConfig } from '../../sema-plc-tools/dist/config.js'
// Note: we direct-import from the built plc-tools dist
import { handleReadVariables } from '../../sema-plc-tools/dist/tools/readVariables.js'
import { handleStatus } from '../../sema-plc-tools/dist/tools/status.js'
import { RuntimeClient } from '../../sema-plc-tools/dist/client/runtime.js'
import type { VariableValue } from '../shared/protocol.js'

export interface PlcMonitorOptions {
  workspace: string
  intervalMs?: number
  plcUrl?: string
  plcUser?: string
  plcPassword?: string
  // Injectable for testing — defaults to plc-tools handleStatus/handleReadVariables
  _handleStatus?: typeof handleStatus
  _handleReadVariables?: typeof handleReadVariables
}

export class PlcMonitor {
  private timer: NodeJS.Timeout | null = null
  private client: any   // RuntimeClient
  private workspace: string
  private intervalMs: number
  private cfg: PlcConfig
  private _handleStatus: typeof handleStatus
  private _handleReadVariables: typeof handleReadVariables

  // Last-seen snapshot for diff
  private lastStatus: string | null = null
  private lastValues: Record<string, VariableValue> = {}

  // Active client count (start polling when >0)
  private activeClients = 0

  // When set, plc:state and plc:values emits are suppressed. Used by
  // plc-controller during Run/Stop transitions so the UI doesn't flicker
  // through transient OpenPLC states (INIT / ERROR / momentary RUNNING).
  private muted = false

  constructor(opts: PlcMonitorOptions) {
    this.workspace = opts.workspace
    this.intervalMs = opts.intervalMs ?? 500
    this._handleStatus = opts._handleStatus ?? handleStatus
    this._handleReadVariables = opts._handleReadVariables ?? handleReadVariables
    this.cfg = {
      url: opts.plcUrl ?? 'https://localhost:8443',
      container: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
      checkStdlibDir: process.env.PLC_CHECK_STDLIB_DIR ?? '/opt/iec61131-stdlib',
      user: opts.plcUser ?? 'admin',
      password: opts.plcPassword ?? 'admin123',
      stateFile: plcStateFileForWorkspace(opts.workspace),
      poolSize: Number(process.env.PLC_POOL_SIZE) || 1, // 占位:monitor 不消费 poolSize
    }
    this.client = new RuntimeClient(this.cfg.url, this.cfg.user, this.cfg.password)
  }

  // Called by ws-gateway when a client connects / disconnects
  clientConnected(): void {
    this.activeClients++
    if (this.activeClients === 1) this.startPolling()
  }
  clientDisconnected(): void {
    this.activeClients = Math.max(0, this.activeClients - 1)
    if (this.activeClients === 0) this.stopPolling()
  }

  startPolling(): void {
    if (this.timer) return
    this.tick().catch(() => {})
    this.timer = setInterval(() => this.tick().catch(() => {}), this.intervalMs)
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getActiveClients(): number { return this.activeClients }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (!muted) {
      // Reset last-seen so the next tick re-emits the truth even if it matches the pre-mute value
      this.lastStatus = null
      this.lastValues = {}
    }
  }

  private async tick(): Promise<void> {
    // Get PLC status; emit state changes
    let status: string
    try {
      const s = await this._handleStatus(this.client)
      status = s.status
      if (status !== this.lastStatus) {
        this.lastStatus = status
        if (!this.muted) bus.emit({ type: 'plc:state', status: status as any })
      }
    } catch {
      // PLC unreachable; skip values
      return
    }

    if (status !== 'RUNNING') return

    // Get values via direct import (no spawn)
    const state = readPlcState(this.cfg.stateFile)
    if (!state.hasState || state.variableMap.length === 0) return

    try {
      const r = await this._handleReadVariables({}, this.cfg)
      if (r.success && hasChanged(this.lastValues, r.variables)) {
        this.lastValues = r.variables
        if (!this.muted) bus.emit({ type: 'plc:values', values: r.variables as any })
      }
    } catch (e) {
      // transient; next tick will retry
    }
  }

  switchWorkspace(newWorkspace: string): void {
    this.stopPolling()
    this.workspace = newWorkspace
    this.cfg.stateFile = plcStateFileForWorkspace(newWorkspace)
    this.lastStatus = null
    this.lastValues = {}
    if (this.activeClients > 0) this.startPolling()
  }
}

function hasChanged(a: Record<string, VariableValue>, b: Record<string, VariableValue>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  if (ka.length !== kb.length) return true
  for (const k of kb) {
    if (a[k]?.value !== b[k]?.value) return true
  }
  return false
}
