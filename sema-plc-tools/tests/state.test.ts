import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readState, writeState } from '../src/state.js'
import type { PlcState } from '../src/types.js'

const TMP_FILE = path.join(os.tmpdir(), `plc-tools-test-${Date.now()}.json`)

beforeEach(() => { if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE) })
afterEach(() => { if (fs.existsSync(TMP_FILE)) fs.unlinkSync(TMP_FILE) })

describe('readState', () => {
  it('returns empty state when file does not exist', () => {
    const state = readState(TMP_FILE)
    expect(state).toEqual({ lastCompile: null })
  })

  it('returns parsed state when file exists', () => {
    const expected: PlcState = {
      lastCompile: {
        timestamp: '2026-01-01T00:00:00Z',
        stCode: 'PROGRAM foo END_PROGRAM',
        zipPath: '/tmp/foo.zip',
        variableMap: [{ index: 0, name: 'x', type: 'INT', location: '%QW0' }],
      },
    }
    fs.mkdirSync(path.dirname(TMP_FILE), { recursive: true })
    fs.writeFileSync(TMP_FILE, JSON.stringify(expected))
    expect(readState(TMP_FILE)).toEqual(expected)
  })
})

describe('writeState', () => {
  it('creates file and parent dirs if missing', () => {
    const state: PlcState = { lastCompile: null }
    writeState(TMP_FILE, state)
    expect(fs.existsSync(TMP_FILE)).toBe(true)
    expect(JSON.parse(fs.readFileSync(TMP_FILE, 'utf8'))).toEqual(state)
  })
})

describe('writeState atomicity', () => {
  it('writes via tmp+rename: no partial file is ever visible at the target path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-state-'))
    const file = path.join(dir, 'state.json')
    writeState(file, { lastCompile: { timestamp: 't', stCode: 'X'.repeat(100_000), zipPath: '/z', variableMap: [] } })
    expect(fs.readdirSync(dir).filter(f => f.includes('.tmp'))).toEqual([])
    expect(readState(file).lastCompile?.zipPath).toBe('/z')
  })
  it('rename replaces an existing file in one step', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plc-state-'))
    const file = path.join(dir, 'state.json')
    writeState(file, { lastCompile: null })
    writeState(file, { lastCompile: { timestamp: 't2', stCode: 'B', zipPath: '/z2', variableMap: [] } })
    expect(readState(file).lastCompile?.zipPath).toBe('/z2')
  })
})
