import { Router } from 'express'
import { handleCheck } from '../../../sema-plc-tools/dist/tools/check.js'
import type { PlcConfig } from '../../../sema-plc-tools/dist/config.js'

export const checkRouter = Router()

// rusty `plc --check` only reads container + checkStdlibDir; the rest are
// placeholders to satisfy the PlcConfig shape (same defaults as plc-controller).
function checkConfig(): PlcConfig {
  return {
    url: process.env.PLC_URL ?? 'https://localhost:8443',
    container: process.env.PLC_CONTAINER ?? 'openplc-plc-dev',
    checkStdlibDir: process.env.PLC_CHECK_STDLIB_DIR ?? '/opt/iec61131-stdlib',
    user: process.env.PLC_USER ?? 'admin',
    password: process.env.PLC_PASSWORD ?? 'admin123',
    stateFile: '',
    poolSize: Number(process.env.PLC_POOL_SIZE) || 1, // 占位:check 不消费 poolSize
  }
}

checkRouter.post('/check', async (req, res) => {
  const stCode = req.body?.stCode
  if (typeof stCode !== 'string' || !stCode.trim()) {
    return res.status(400).json({ ok: false, errors: [], raw: '', errorMessage: 'stCode is required (non-empty string)' })
  }
  try {
    const result = await handleCheck({ stCode }, checkConfig())
    res.json(result)
  } catch (e: any) {
    res.status(500).json({ ok: false, errors: [], raw: '', errorMessage: e?.message ?? String(e) })
  }
})
