import * as fs from 'fs'
import * as path from 'path'
import { safePath } from './pathSafety.js'
import type { VariableEntry } from '../shared/protocol.js'

export interface PlcState {
  hasState: boolean
  variableMap: VariableEntry[]
  stCode: string | null
  compiledAt: string | null
  zipPath: string | null
  error?: string
}

/**
 * Reads plc-tools state.json from the per-workspace location.
 * In v2, state.json lives at $WORKSPACE/.plc-vis/state.json (set via PLC_STATE_FILE
 * env var in the workspace's .sema/.mcp.json template).
 */
export function readPlcState(stateFile: string): PlcState {
  const sf = safePath(stateFile)
  try {
    if (!fs.existsSync(sf)) {
      return { hasState: false, variableMap: [], stCode: null, compiledAt: null, zipPath: null }
    }
    const raw = JSON.parse(fs.readFileSync(sf, 'utf8'))
    const last = raw?.lastCompile
    if (!last) {
      return { hasState: false, variableMap: [], stCode: null, compiledAt: null, zipPath: null }
    }
    return {
      hasState: true,
      variableMap: last.variableMap ?? [],
      stCode: last.stCode ?? null,
      compiledAt: last.timestamp ?? null,
      zipPath: last.zipPath ?? null,
    }
  } catch (e) {
    return {
      hasState: false,
      variableMap: [],
      stCode: null,
      compiledAt: null,
      zipPath: null,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export function plcStateFileForWorkspace(workspace: string): string {
  return path.join(workspace, '.plc-vis', 'state.json')
}
