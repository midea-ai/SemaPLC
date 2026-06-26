import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readPlcState, plcStateFileForWorkspace } from '../../server/state-reader.js'

const TMP_DIR = path.join(os.tmpdir(), `plc-vis-state-reader-${Date.now()}`)
const TMP_STATE = path.join(TMP_DIR, 'state.json')

beforeEach(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true })
  try { fs.unlinkSync(TMP_STATE) } catch {}
})
afterEach(() => {
  try { fs.unlinkSync(TMP_STATE) } catch {}
  try { fs.rmdirSync(TMP_DIR) } catch {}
})

describe('readPlcState', () => {
  it('returns hasState=false when file missing', () => {
    const r = readPlcState(TMP_STATE)
    expect(r.hasState).toBe(false)
    expect(r.variableMap).toEqual([])
    expect(r.stCode).toBeNull()
    expect(r.zipPath).toBeNull()
  })

  it('returns parsed fields including zipPath', () => {
    fs.writeFileSync(TMP_STATE, JSON.stringify({
      lastCompile: {
        timestamp: '2026-05-21T00:00:00Z',
        stCode: 'PROGRAM x END_PROGRAM',
        zipPath: '/tmp/x.zip',
        variableMap: [{ index: 0, name: 'a', type: 'BOOL', location: '%QX0.0' }],
      },
    }))
    const r = readPlcState(TMP_STATE)
    expect(r.hasState).toBe(true)
    expect(r.variableMap).toHaveLength(1)
    expect(r.zipPath).toBe('/tmp/x.zip')
    expect(r.compiledAt).toBe('2026-05-21T00:00:00Z')
  })

  it('returns error when JSON malformed', () => {
    fs.writeFileSync(TMP_STATE, '{not valid')
    const r = readPlcState(TMP_STATE)
    expect(r.hasState).toBe(false)
    expect(r.error).toBeDefined()
  })
})

describe('plcStateFileForWorkspace', () => {
  it('returns $workspace/.plc-vis/state.json', () => {
    expect(plcStateFileForWorkspace('/foo/bar')).toBe('/foo/bar/.plc-vis/state.json')
  })
})
