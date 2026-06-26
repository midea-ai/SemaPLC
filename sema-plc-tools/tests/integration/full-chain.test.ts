// tests/integration/full-chain.test.ts
// Run with: npm run test:integration
// Requires: Docker container 'openplc-plc-dev' running (W1-D1-D2)

import { describe, it, expect, beforeAll } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import { handleCompile } from '../../src/tools/compile.js'
import { handleUpload } from '../../src/tools/upload.js'
import { handleStart } from '../../src/tools/start.js'
import { handleStop } from '../../src/tools/stop.js'
import { handleStatus } from '../../src/tools/status.js'
import { handleReadVariables } from '../../src/tools/readVariables.js'
import { RuntimeClient } from '../../src/client/runtime.js'
import type { PlcConfig } from '../../src/config.js'

const STATE_FILE = path.join(os.tmpdir(), 'plc-tools-integration-test.json')
const cfg: PlcConfig = {
  url: process.env.PLC_URL ?? 'https://localhost:8443',
  container: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
  user: process.env.PLC_USER ?? 'admin',
  password: process.env.PLC_PASSWORD ?? 'admin123',
  stateFile: STATE_FILE,
}

// W1-D3 chain_verify.st — counter program with AT variables
const CHAIN_VERIFY_ST = `
PROGRAM chain_verify
  VAR
    scan_count AT %QW0 : INT;
    output_flag AT %QX0.0 : BOOL;
    real_val AT %QD0 : REAL;
  END_VAR
  scan_count := scan_count + 1;
  output_flag := (scan_count MOD 2) = 0;
  real_val := INT_TO_REAL(scan_count) * 0.1;
END_PROGRAM

CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK TaskMain(INTERVAL := T#100ms, PRIORITY := 0);
    PROGRAM Inst0 WITH TaskMain : chain_verify;
  END_RESOURCE
END_CONFIGURATION
`

describe('Full chain integration', () => {
  let client: RuntimeClient

  beforeAll(async () => {
    client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
    // Stop any running PLC
    await handleStop(client).catch(() => {})
    // 预热换载(0613 取证 probe3):OpenPLC 有 upload→start 换载竞态——upload 报
    // gcc SUCCESS、start 报 RUNNING,但 ~1/6 概率 start 拉起的是上一个已加载程序
    // (上一文件的 passthrough),此时按 chain_verify 的 variableMap 读 scan_count
    // 得 undefined(0x44 响应只有 1 字节 BOOL)——0612"漂移失败"中本文件的根因。
    // stop→start 一轮即换载。对策:先把 chain_verify upload+start+stop 预热一轮,
    // 使"已加载程序 == 本文件的程序",后续 test2/3 的竞态退化为无害(旧==新)。
    // 这是 runtime 真 bug,工具层无感知,已另行上报;此处只做测试侧消弭。
    const c = await handleCompile({ stCode: CHAIN_VERIFY_ST }, cfg)
    if (!c.success) throw new Error(`预热 compile 失败:${c.errorSummary}`)
    const u = await handleUpload({}, cfg)
    if (!u.success) throw new Error(`预热 upload 失败:gcc=${u.gccStatus} ${u.uploadError ?? ''}`)
    await handleStart(client)   // 竞态拉起旧程序也无妨:最新 .so 已是 chain_verify
    await handleStop(client)    // 下一次 start(test3)从停机态加载的就是 chain_verify
  }, 120_000)

  it('compiles chain_verify.st successfully', async () => {
    const result = await handleCompile({ stCode: CHAIN_VERIFY_ST }, cfg)
    expect(result.success).toBe(true)
    expect(result.failedStage).toBeNull()
    expect(result.zipPath).toBeTruthy()
    expect(result.variableMap.length).toBeGreaterThan(0)
    expect(result.variableMap.find(v => v.name === 'scan_count')).toBeDefined()
  }, 30_000)

  it('uploads ZIP and GCC compiles successfully', async () => {
    const result = await handleUpload({}, cfg)
    expect(result.success).toBe(true)
    expect(result.gccStatus).toBe('SUCCESS')
  }, 120_000)

  it('starts PLC and verifies RUNNING status', async () => {
    const result = await handleStart(client)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('RUNNING')
  }, 15_000)

  it('reads scan_count variable (should be non-zero after running)', async () => {
    // Wait 1 scan cycle
    await new Promise(r => setTimeout(r, 500))
    const result = await handleReadVariables({ varNames: ['scan_count'] }, cfg)
    expect(result.success).toBe(true)
    expect(result.variables['scan_count']).toBeDefined()
    expect(typeof result.variables['scan_count'].value).toBe('number')
    expect(result.variables['scan_count'].value).toBeGreaterThan(0)
    expect(result.unresolvedNames).toEqual([])
  }, 15_000)

  it('stops PLC cleanly', async () => {
    const result = await handleStop(client)
    expect(result.success).toBe(true)
    expect(result.actualStatus).toBe('STOPPED')
  }, 15_000)
})
