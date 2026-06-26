import { execFile } from 'child_process'
import * as path from 'path'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import { runCompileChain } from '../compiler.js'
import { readState, writeState } from '../state.js'
import { detectIO, findUnassignedOutputs } from './detectIO.js'
import { buildModbusSlaveConfig } from './modbusConfig.js'
import type { CompileResult, VariableEntry } from '../types.js'
import type { PlcConfig } from '../config.js'
import type { ExecFn } from '../compiler.js'

const execFileAsync = promisify(execFile)

type ReadCsvFn = (container: string, zipPath: string) => Promise<string>
export type InjectModbusConfFn = (container: string, zipPath: string, configJson: string) => Promise<void>

// Add conf/modbus_slave.json to the program ZIP (in-container) so OpenPLC's
// update_plugin_configurations auto-enables the Modbus slave on upload.
async function realInjectModbusConf(container: string, zipPath: string, configJson: string): Promise<void> {
  const workDir = path.posix.dirname(zipPath)
  const tmp = path.join(os.tmpdir(), `modbus_slave_${process.pid}_${workDir.replace(/\W/g, '')}.json`)
  fs.writeFileSync(tmp, configJson, 'utf8')
  try {
    await execFileAsync('docker', ['exec', container, 'mkdir', '-p', `${workDir}/conf`])
    await execFileAsync('docker', ['cp', tmp, `${container}:${workDir}/conf/modbus_slave.json`])
    await execFileAsync('docker', ['exec', container, 'bash', '-c', `cd "${workDir}" && zip -q "${zipPath}" conf/modbus_slave.json`])
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

// Parse VARIABLES.csv from container: name,type,location,index
export function parseVariablesCsv(csv: string): VariableEntry[] {
  return csv
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))
    .map((line, fallbackIndex) => {
      const [name, type, location, indexStr] = line.split(',')
      return {
        index: indexStr !== undefined ? parseInt(indexStr, 10) : fallbackIndex,
        name: name?.trim() ?? '',
        type: type?.trim() ?? 'ANY',
        location: location?.trim() ?? '',
      }
    })
    .filter(v => v.name)
}

// Normalize matiec VARIABLES.csv (semicolon-separated, hierarchical names) to
// the comma-separated format expected by parseVariablesCsv: name,type,location,index
// Actual format: index;kind;fullpath;fullpath;type;nativeType;debug_idx;
//
// IMPORTANT: The debug protocol index is 0-based into the debug_vars[] array in debug.c.
// The VARIABLES.csv 'FB' rows represent program instances (not debug variables) and are
// excluded from debug_vars[]. So we renumber variables starting from 0, skipping FB rows.
//
// Name shape: fullPath looks like `CONFIG0.RES0.INST0.<NAME>` for program-level
// variables, or `CONFIG0.RES0.INST0.<FB_INSTANCE>.<PORT>` for nested FB outputs.
// To avoid collisions (e.g. multiple TONs all having `.Q`), we keep everything
// after the first 3 segments and join with '.' — e.g. `hb_out` for program vars,
// `timer1.q` / `rtrig.q` for FB outputs. Lowercased.
export function normalizeCsv(raw: string): string {
  const lines: string[] = []
  let debugIdx = 0
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and blank lines
    if (!trimmed || trimmed.startsWith('//')) continue
    // Try semicolon-separated format first
    const parts = trimmed.split(';')
    if (parts.length >= 5) {
      const kind = parts[1]
      const fullPath = parts[2]
      const type = parts[4]
      // Skip FB (function block instance) rows; keep IN/OUT/INOUT variable rows
      if (kind === 'FB' || !fullPath || !type) continue
      // Drop the CONFIG.RES.INST prefix; keep remaining segments joined.
      // FB outputs keep their instance prefix so timer1.q ≠ timer2.q ≠ rtrig.q.
      const segs = fullPath.split('.')
      if (segs.length < 4) continue   // structural rows (CONFIG, RESOURCE itself)
      const shortName = segs.slice(3).join('.').toLowerCase()
      // Use 0-based sequential index matching the debug_vars[] array in debug.c
      lines.push(`${shortName},${type},,${debugIdx}`)
      debugIdx++
    }
  }
  return lines.join('\n')
}

async function realReadCsv(container: string, zipPath: string): Promise<string> {
  // Derive the work dir from the zip path: same directory as the generated ZIP
  const workDir = path.posix.dirname(zipPath)
  const { stdout: found } = await execFileAsync('docker', [
    'exec', container, 'bash', '-c',
    `cat "${workDir}/VARIABLES.csv" 2>/dev/null || echo ""`,
  ]).catch(() => ({ stdout: '' }))
  return normalizeCsv(found)
}

// Build a map of lowercase variable name → AT location from ST source code.
// Location may include a bit suffix (e.g. %IX0.0), so we match digits and dots.
function buildAtLocationMap(stCode: string): Map<string, string> {
  const map = new Map<string, string>()
  const re = /(\w+)\s+AT\s+(%[A-Z]+[0-9][0-9.]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(stCode)) !== null) {
    map.set(m[1].toLowerCase(), m[2])
  }
  return map
}

export async function handleCompile(
  input: { stCode: string },
  cfg: PlcConfig,
  execFn?: ExecFn,
  readCsvFn: ReadCsvFn = realReadCsv,
  injectConfFn: InjectModbusConfFn = realInjectModbusConf,
): Promise<CompileResult> {
  // Semantic gate (P0b), before matiec: a declared %Q output that the body never
  // assigns is a "dead output" — matiec compiles it fine, but the actuator never
  // acts at runtime. Hard-fail here (covers both plc_compile and plc_buildAndRun,
  // which routes through this) so it can't reach "runs successfully" unnoticed.
  const deadOutputs = findUnassignedOutputs(input.stCode)
  if (deadOutputs.length) {
    const names = deadOutputs.join(', ')
    return {
      success: false,
      failedStage: 'validate',
      iec2c: {
        success: false,
        errors: [{
          line: 0, col: 0, severity: 'error', sourceLine: '',
          message: `declared output(s) never assigned: ${names}`,
          advice: `这些 %Q 输出在程序体里从无赋值(找不到 \`<名> :=\`),运行时恒为初值——"死输出",执行器永远不动作。给每个输出补驱动逻辑(谁、在什么条件下给它赋值),或删掉确实没用到的声明。最常见:执行器输出(传送带 conveyor_run / 电机 motor_on)声明了却忘了置位。`,
        }],
        warnings: [],
        generatedFiles: [],
      },
      xml2st: { debugSuccess: false, glueVarsSuccess: false, errors: [] },
      variableMap: [],
      zipPath: null,
      errorSummary: `死输出(声明却无赋值): ${names}`,
    }
  }

  const compileResult = await runCompileChain(input.stCode, cfg.container, execFn)

  if (!compileResult.success) return compileResult

  // Opt-in (PLC_MODBUS_PORT): bundle a modbus_slave config into the ZIP so the
  // uploaded program exposes its located IO over Modbus TCP (for FUXA). Off by default.
  if (cfg.modbusPort != null) {
    const conf = JSON.stringify(buildModbusSlaveConfig(detectIO(input.stCode).io, { port: cfg.modbusPort }))
    await injectConfFn(cfg.container, compileResult.zipPath!, conf)
  }

  // Read VARIABLES.csv to populate variableMap
  const csv = await readCsvFn(cfg.container, compileResult.zipPath!).catch(() => '')
  const rawVariableMap = parseVariablesCsv(csv)

  // Fill in AT locations from stCode for variables that don't already have one
  const atMap = buildAtLocationMap(input.stCode)
  const variableMap = rawVariableMap.map(entry => ({
    ...entry,
    location: entry.location || (atMap.get(entry.name) ?? ''),
  }))
  compileResult.variableMap = variableMap

  // Cache to state file for plc.upload and plc.readVariables
  const state = readState(cfg.stateFile)
  writeState(cfg.stateFile, {
    ...state,
    lastCompile: {
      timestamp: new Date().toISOString(),
      stCode: input.stCode,
      zipPath: compileResult.zipPath!,
      variableMap,
    },
  })

  return compileResult
}
