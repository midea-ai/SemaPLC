import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import { safePath } from '../../src/pathSafety.js'
import * as path from 'path'
import { handleRecord } from '../../src/tools/record.js'
import type { PlcConfig } from '../../src/config.js'
import type { PlcState } from '../../src/types.js'

const TMP_STATE = path.join(os.tmpdir(), `record-test-${Date.now()}.json`)
const TMP_WORKSPACE = path.join(os.tmpdir(), `record-test-ws-${Date.now()}`)
const cfg: PlcConfig = {
  url: 'https://localhost:8443',
  container: 'c',
  checkStdlibDir: '/opt/iec61131-stdlib',
  user: 'admin',
  password: process.env.PLC_TEST_PW ?? 'pw',
  stateFile: TMP_STATE,
  workspace: TMP_WORKSPACE,
}

const varMap = [
  { index: 0, name: 'led', type: 'BOOL', location: '%QX0.0' },
  { index: 1, name: 'cnt', type: 'INT', location: '%QW0' },
  { index: 2, name: 'msg', type: 'STRING', location: '' },
  { index: 3, name: 'sensor', type: 'REAL', location: '%IW0' },
]

const GOOD_MD5 = 'M'.repeat(32)

// Synthetic recording matching fetchRecording's return shape ({header, frames}):
// ticks 100..107, led bytes [0,0,1,1,1,0,0,0], cnt u16LE 1..8.
// msg (idx 2) is NOT in header.vars — the recorder skipped it (skipped:1),
// which is exactly what skippedUnrecordable is judged from.
// sensor (idx 3) is optional: included when withSensor is true.
// IEEE 754 float32 LE NaN = [0x00, 0x00, 0xC0, 0x7F] (quiet NaN, always evaluates
// as NaN regardless of endianness — 0x7FC00000 in big-endian, exponent all 1s,
// mantissa non-zero).
const NAN_FLOAT32_LE = [0x00, 0x00, 0xC0, 0x7F]
const ONE_FLOAT32_LE = [0x00, 0x00, 0x80, 0x3F]  // 1.0f

function makeFetchMock(headerOverrides: { md5?: string } = {}, withSensor = false) {
  const ledBytes = [0, 0, 1, 1, 1, 0, 0, 0]
  const frames = ledBytes.map((led, i) => {
    const cnt = i + 1
    const base = [led, cnt & 0xff, (cnt >> 8) & 0xff]
    // sensor slot: 4 bytes appended after cnt (off=3)
    const sensorBytes = withSensor ? NAN_FLOAT32_LE : []
    return { tick: BigInt(100 + i), slot: [...base, ...sensorBytes] }
  })
  const headerVars: Array<{ idx: number; off: number; size: number }> = [
    { idx: 0, off: 0, size: 1 },
    { idx: 1, off: 1, size: 2 },
  ]
  if (withSensor) headerVars.push({ idx: 3, off: 3, size: 4 })
  const header = {
    ver: 1, nrec: withSensor ? 3 : 2, skipped: 1, decimation: 1,
    slotSize: withSensor ? 7 : 3, frames: 4000, count: 8,
    md5: headerOverrides.md5 ?? GOOD_MD5,
    vars: headerVars,
  }
  return vi.fn(async (_b: string, _t: string, _o: { fromTick: bigint; maxFrames: number; timeoutMs?: number }) => ({ header, frames }))
}

// Mock returning frames where sensor transitions from NaN to 1.0 on the last frame.
function makeFetchMockNanToValue() {
  const ledBytes = [0, 0, 1, 1, 1, 0, 0, 0]
  const frames = ledBytes.map((led, i) => {
    const cnt = i + 1
    const base = [led, cnt & 0xff, (cnt >> 8) & 0xff]
    // Last frame: sensor becomes 1.0; all others are NaN
    const sensorBytes = i === ledBytes.length - 1 ? ONE_FLOAT32_LE : NAN_FLOAT32_LE
    return { tick: BigInt(100 + i), slot: [...base, ...sensorBytes] }
  })
  const header = {
    ver: 1, nrec: 3, skipped: 1, decimation: 1,
    slotSize: 7, frames: 4000, count: 8,
    md5: GOOD_MD5,
    vars: [
      { idx: 0, off: 0, size: 1 },
      { idx: 1, off: 1, size: 2 },
      { idx: 3, off: 3, size: 4 },
    ],
  }
  return vi.fn(async (_b: string, _t: string, _o: { fromTick: bigint; maxFrames: number; timeoutMs?: number }) => ({ header, frames }))
}

beforeEach(() => {
  const state: PlcState = {
    lastCompile: { timestamp: '', stCode: '', zipPath: '', variableMap: varMap },
  }
  fs.mkdirSync(path.dirname(TMP_STATE), { recursive: true })
  fs.writeFileSync(TMP_STATE, JSON.stringify(state))
  fs.mkdirSync(TMP_WORKSPACE, { recursive: true })
})

afterEach(() => {
  try { fs.unlinkSync(TMP_STATE) } catch {}
  try { fs.rmSync(TMP_WORKSPACE, { recursive: true, force: true }) } catch {}
  vi.restoreAllMocks()
})

describe('handleRecord', () => {
  it('changes-only 编码: led 两个转折; cnt 超 cap 走摘要+落盘', async () => {
    const fetchMock = makeFetchMock()
    const r = await handleRecord({ varNames: ['led', 'cnt'] }, cfg, fetchMock, { md5Live: GOOD_MD5, transitionCap: 3 })
    expect(r.success).toBe(true)
    const led = r.series.find(s => s.name === 'led')!
    expect(led.first).toBe(false)
    expect(led.transitions).toEqual([[102, true], [105, false]])
    expect(led.truncated).toBe(false)
    const cnt = r.series.find(s => s.name === 'cnt')!
    expect(cnt.truncated).toBe(true)                       // 7 个转折 > cap 3
    expect(cnt.summary).toMatchObject({ min: 1, max: 8, last: 8, monotonic: true })
    expect(r.fullDumpFile).toMatch(/record-.*\.json$/)
    expect(fs.existsSync(safePath(r.fullDumpFile!))).toBe(true)
    expect(r.window).toMatchObject({ fromTick: 100, toTick: 107 })
    expect(r.programMd5Verified).toBe(true)
  })

  it('md5 门: 录波头与运行程序不符 → 拒绝解码', async () => {
    const r = await handleRecord({ varNames: ['led'] }, cfg, makeFetchMock(), { md5Live: 'X'.repeat(32) })
    expect(r.success).toBe(false)
    expect(r.programMd5Verified).toBe(false)
    expect(r.errorMessage).toMatch(/程序已变更/)
    expect(r.series).toEqual([])
  })

  it('md5 全 ? (插件拿不到): programMd5Verified=false 但不拒绝,带 note 语义', async () => {
    const r = await handleRecord({ varNames: ['led'] }, cfg, makeFetchMock({ md5: '?'.repeat(32) }), { md5Live: GOOD_MD5 })
    expect(r.success).toBe(true)
    expect(r.programMd5Verified).toBe(false)
    expect(r.errorMessage).toBeNull()
    expect(r.note).toMatch(/md5/i)
    expect(r.series.some(s => s.name === 'led')).toBe(true)
  })

  it('STRING 变量 fail-loud', async () => {
    const r = await handleRecord({ varNames: ['msg'] }, cfg, makeFetchMock(), { md5Live: GOOD_MD5 })
    expect(r.skippedUnrecordable).toContain('msg')
    expect(r.series).toEqual([])
  })

  it('varNames 大小写不敏感 + did-you-mean', async () => {
    const r = await handleRecord({ varNames: ['LED', 'cnnt'] }, cfg, makeFetchMock(), { md5Live: GOOD_MD5 })
    expect(r.series.some(s => s.name === 'led')).toBe(true)
    expect(r.unresolvedNames).toContain('cnnt')
    expect(r.nameSuggestions?.cnnt).toBe('cnt')
  })

  it('窗口过滤: fromTick=104 只取 104..107', async () => {
    const r = await handleRecord({ varNames: ['led'], fromTick: 104 }, cfg, makeFetchMock(), { md5Live: GOOD_MD5 })
    expect(r.success).toBe(true)
    const led = r.series.find(s => s.name === 'led')!
    expect(led.first).toBe(true)
    expect(led.transitions).toEqual([[105, false]])
    expect(r.window).toMatchObject({ fromTick: 104, toTick: 107 })
  })

  it('varNames 空数组: 直接报错不 fetch', async () => {
    const fetchMock = makeFetchMock()
    const r = await handleRecord({ varNames: [] }, cfg, fetchMock, { md5Live: GOOD_MD5 })
    expect(r.success).toBe(false)
    expect(r.errorMessage).toMatch(/varNames|必填/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('REAL NaN 连续帧: transitions 为空(NaN→NaN 不算转折), truncated=false, note 含 NaN 提示', async () => {
    // All 8 frames have sensor=NaN — strict !== would produce 7 spurious transitions
    const fetchMock = makeFetchMock({}, true)
    const r = await handleRecord({ varNames: ['sensor'] }, cfg, fetchMock, { md5Live: GOOD_MD5 })
    expect(r.success).toBe(true)
    const s = r.series.find(s => s.name === 'sensor')!
    expect(s).toBeDefined()
    // NaN→NaN must NOT count as a transition
    expect(s.transitions).toEqual([])
    expect(s.truncated).toBe(false)
    // result.note must warn about NaN
    expect(r.note).toMatch(/NaN/i)
  })

  it('REAL NaN→正常值: 最后一帧恢复为 1.0, transitions 有一次, 转折值序列化为 null(JSON NaN), note 含 NaN', async () => {
    // Frames 0-6: NaN, frame 7: 1.0 — exactly one real transition (NaN → 1.0)
    // Actually NaN→1.0 IS a transition (values changed), recorded as [tick, 1.0]
    // And first value is NaN → serialises to null in JSON, note must warn
    const fetchMock = makeFetchMockNanToValue()
    const r = await handleRecord({ varNames: ['sensor'] }, cfg, fetchMock, { md5Live: GOOD_MD5 })
    expect(r.success).toBe(true)
    const s = r.series.find(s => s.name === 'sensor')!
    expect(s).toBeDefined()
    // first value is NaN (serialises to null in JSON)
    expect(JSON.parse(JSON.stringify(s.first))).toBeNull()
    // One transition: tick 107, value 1.0
    expect(s.transitions).toHaveLength(1)
    expect(s.transitions[0][0]).toBe(107)
    expect(s.transitions[0][1]).toBeCloseTo(1.0)
    expect(s.truncated).toBe(false)
    expect(r.note).toMatch(/NaN/i)
  })

  it('REAL NaN 不污染 summary.min/max(全 NaN 序列超 cap 时 summary 无 min/max)', async () => {
    // Use a very small cap (0) to force truncation on even an empty transitions list.
    // All frames are NaN → summary should not carry NaN min/max.
    const fetchMock = makeFetchMock({}, true)
    const r = await handleRecord({ varNames: ['sensor'] }, cfg, fetchMock, { md5Live: GOOD_MD5, transitionCap: 0 })
    expect(r.success).toBe(true)
    const s = r.series.find(s => s.name === 'sensor')!
    expect(s).toBeDefined()
    // When all values are NaN, min/max must be absent (not NaN)
    if (s.summary) {
      expect(s.summary.min).toBeUndefined()
      expect(s.summary.max).toBeUndefined()
    }
  })
})
