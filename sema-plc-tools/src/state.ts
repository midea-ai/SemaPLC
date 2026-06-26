import * as fs from 'fs'
import * as path from 'path'
import type { PlcState } from './types.js'
import { safePath } from './pathSafety.js'

const EMPTY_STATE: PlcState = { lastCompile: null }

export function readState(stateFile: string): PlcState {
  const sf = safePath(stateFile)
  try {
    if (!fs.existsSync(sf)) return { ...EMPTY_STATE }
    return JSON.parse(fs.readFileSync(sf, 'utf8')) as PlcState
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function writeState(stateFile: string, state: PlcState): void {
  const sf = safePath(stateFile)
  fs.mkdirSync(safePath(path.dirname(sf)), { recursive: true })
  // Atomic replace: a concurrent reader (MCP server / plc-monitor / runner) must
  // never observe a half-written JSON — torn reads were being mis-reported as
  // "No variable map found. Run plc.compile first." downstream.
  const tmp = safePath(`${sf}.${process.pid}.tmp`)
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.renameSync(tmp, sf)
}
