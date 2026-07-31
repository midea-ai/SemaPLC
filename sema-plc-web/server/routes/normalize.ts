import { Router } from 'express'
import { spawn } from 'child_process'
import * as crypto from 'crypto'

export const normalizeRouter = Router()

// Validate the container name against Docker's allowed charset before it is ever
// passed to `docker exec`, so a hostile PLC_CONTAINER cannot inject arguments.
function safeContainerName(raw: string | undefined): string {
  const name = raw ?? 'openplc-plc-dev'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    throw new Error(`Invalid PLC_CONTAINER '${name}'`)
  }
  return name
}
const CONTAINER = safeContainerName(process.env.PLC_CONTAINER)

// PLC_DOCKER_BIN — docker 可执行文件替代(podman 等),同款白名单校验后才进 spawn。
function safeDockerBin(raw: string | undefined): string {
  const bin = raw || 'docker'
  if (!/^[A-Za-z0-9._/-]+$/.test(bin)) {
    throw new Error(`Invalid PLC_DOCKER_BIN '${bin}'`)
  }
  return bin
}
const DOCKER = safeDockerBin(process.env.PLC_DOCKER_BIN)
const MATIEC_DIR = '/usr/local/share/matiec'
const MARKER = '{enable code generation}'

/** Extract the user program from iec2iec's full output (which includes the entire standard library) */
export function extractUserProgram(raw: string): string {
  const idx = raw.lastIndexOf(MARKER)
  if (idx === -1) return raw.trim()
  return raw.slice(idx + MARKER.length).trim()
}

async function dockerExecIec2iec(stCode: string): Promise<{ output: string; error: string | null }> {
  const tmpName = `vis_${crypto.randomBytes(6).toString('hex')}.st`
  const containerPath = `/tmp/${tmpName}`

  // Step 1: write file inside container via stdin
  await new Promise<void>((resolve, reject) => {
    const w = spawn(DOCKER, ['exec', '-i', CONTAINER, 'bash', '-c', `cat > ${containerPath}`])
    w.stdin.write(stCode)
    w.stdin.end()
    w.on('close', (c) => c === 0 ? resolve() : reject(new Error(`write failed: code ${c}`)))
    w.on('error', reject)
  })

  // Step 2: run iec2iec
  const result = await new Promise<{ stdout: string; stderr: string; code: number }>((resolve) => {
    const p = spawn(DOCKER, ['exec', '-w', MATIEC_DIR, CONTAINER, 'iec2iec', containerPath])
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (d) => { stdout += d })
    p.stderr.on('data', (d) => { stderr += d })
    p.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }))
  })

  // Step 3: best-effort cleanup
  spawn(DOCKER, ['exec', CONTAINER, 'rm', '-f', containerPath]).on('close', () => {})

  if (result.code !== 0) {
    return { output: '', error: (result.stderr || result.stdout || 'iec2iec failed').slice(0, 500) }
  }
  return { output: extractUserProgram(result.stdout), error: null }
}

normalizeRouter.post('/normalize', async (req, res) => {
  const stCode = req.body?.stCode
  if (typeof stCode !== 'string' || !stCode.trim()) {
    return res.status(400).json({ normalized: '', error: 'stCode is required (non-empty string)' })
  }
  try {
    const { output, error } = await dockerExecIec2iec(stCode)
    if (error) return res.status(200).json({ normalized: '', error })
    res.json({ normalized: output, error: null })
  } catch (e: any) {
    res.status(500).json({ normalized: '', error: e.message })
  }
})
