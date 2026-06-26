import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { handleReadVariables } from '../../src/tools/readVariables.js'
import type { PlcConfig } from '../../src/config.js'
import type { PlcState } from '../../src/types.js'

const TMP_STATE = path.join(os.tmpdir(), `rv-test-${Date.now()}.json`)
const cfg: PlcConfig = {
  url: 'https://localhost:8443',
  container: 'c',
  user: 'admin',
  password: process.env.PLC_TEST_PW ?? 'pw',
  stateFile: TMP_STATE,
}

const varMap = [
  { index: 0, name: 'scan_count', type: 'INT', location: '%QW0' },
  { index: 1, name: 'flag', type: 'BOOL', location: '%QX0.0' },
]

beforeEach(() => {
  const state: PlcState = {
    lastCompile: {
      timestamp: '',
      stCode: '',
      zipPath: '',
      variableMap: varMap,
    },
  }
  fs.mkdirSync(path.dirname(TMP_STATE), { recursive: true })
  fs.writeFileSync(TMP_STATE, JSON.stringify(state))
})

afterEach(() => {
  try {
    fs.unlinkSync(TMP_STATE)
  } catch {}
  vi.restoreAllMocks()
})

describe('handleReadVariables', () => {
  it('reads all variables when no varNames specified', async () => {
    const mockRead = vi.fn().mockResolvedValue({
      tick: 777,
      values: {
        scan_count: { value: 42, type: 'INT', index: 0, location: '%QW0' },
        flag: { value: true, type: 'BOOL', index: 1, location: '%QX0.0' },
      },
    })
    const result = await handleReadVariables({}, cfg, mockRead)
    expect(result.success).toBe(true)
    expect(result.variables['scan_count'].value).toBe(42)
    expect(result.tick).toBe(777)
    expect(result.unresolvedNames).toEqual([])
  })

  it('reports unresolved names for unknown variables', async () => {
    const mockRead = vi.fn().mockResolvedValue({
      tick: 1,
      values: { scan_count: { value: 1, type: 'INT', index: 0, location: '%QW0' } },
    })
    const result = await handleReadVariables(
      { varNames: ['scan_count', 'nonexistent'] },
      cfg,
      mockRead,
    )
    expect(result.unresolvedNames).toContain('nonexistent')
    expect(result.success).toBe(true)
  })

  it('resolves a case-variant name directly (matiec lowercases; IEC is case-insensitive)', async () => {
    const mockRead = vi.fn().mockResolvedValue({ tick: 1, values: { scan_count: { value: 7, type: 'INT', index: 0, location: '%QW0' } } })
    const result = await handleReadVariables({ varNames: ['Scan_Count'] }, cfg, mockRead)
    expect(result.unresolvedNames).toEqual([])          // resolved, NOT unresolved
    expect(result.nameSuggestions).toBeUndefined()
    expect(mockRead.mock.calls[0][2].map((e: any) => e.name)).toContain('scan_count')
  })

  it('suggests the nearest name for a typo', async () => {
    const mockRead = vi.fn().mockResolvedValue({})
    const result = await handleReadVariables({ varNames: ['flga'] }, cfg, mockRead)
    expect(result.nameSuggestions?.['flga']).toBe('flag')
  })

  it('returns error when no compile state', async () => {
    fs.writeFileSync(TMP_STATE, JSON.stringify({ lastCompile: null }))
    const result = await handleReadVariables({}, cfg, vi.fn())
    expect(result.success).toBe(false)
    expect(result.errorMessage).toContain('No variable map')
  })
})
