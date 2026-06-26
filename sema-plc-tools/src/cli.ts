#!/usr/bin/env node
import { Command } from 'commander'
import { loadConfig } from './config.js'
import { RuntimeClient } from './client/runtime.js'
import { handleStatus } from './tools/status.js'
import { handleCompile } from './tools/compile.js'
import { startMcpServer } from './server.js'
import * as fs from 'fs'

const program = new Command()
  .name('plc-tools')
  .description('@sema/plc-tools — PLC Tool Provider for Sema Code Core')
  .version('0.1.0')

program
  .command('serve')
  .description('Start MCP stdio server (used by Sema Core MCPServerConfig)')
  .option('--lite', 'register read-only/low-risk tools only')
  .action(async (opts) => {
    await startMcpServer({ lite: !!opts.lite })
  })

program
  .command('verify <planFile>')
  .description('Run a declarative verify plan: build → drive cases → assert → cleanup. Prints a JSON envelope to stdout.')
  .option('--only <caseName>', '迭代辅助:只跑指定 case(子集运行不写 latest.json,出图前仍需一次全量 verify)')
  .action(async (planFile: string, opts: { only?: string }) => {
    const fallback = (msg: string) => console.log(JSON.stringify({
      ok: false, summary: msg, stHash: null, steps: [],
      failure: { stage: 'exception', detail: msg },
      cleanup: { released: [], releaseFailed: [], stopOk: null }, artifacts: { runDir: null },
    }, null, 2))
    try {
      const { runVerifyCli } = await import('./verify/cliEntry.js')   // 动态 import = 自举 shim
      const exitCode = await runVerifyCli(planFile, { only: opts.only })
      process.exit(exitCode)
    } catch (e) {
      fallback(`runner 自举失败(非 plan 问题,报告用户,勿自行修环境): ${e instanceof Error ? e.message : e}`)
      process.exit(0)
    }
  })

program
  .command('status')
  .description('Quick PLC status check')
  .action(async () => {
    const cfg = loadConfig()
    const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
    const result = await handleStatus(client)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.isRunning ? 0 : 1)
  })

program
  .command('compile <file>')
  .description('Compile ST file and print result')
  .action(async (file: string) => {
    const cfg = loadConfig()
    const stCode = fs.readFileSync(file, 'utf8')
    const result = await handleCompile({ stCode }, cfg)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  })

program
  .command('detectIO <file>')
  .description('Extract located-IO (AT declarations) from an ST file and print the IO map')
  .action(async (file: string) => {
    const { detectIO } = await import('./tools/detectIO.js')
    const stCode = fs.readFileSync(file, 'utf8')
    const result = detectIO(stCode)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.count > 0 ? 0 : 1)
  })

program
  .command('genModbusConfig <file>')
  .description('Generate the modbus_slave plugin config (network + buffer_mapping) from an ST file\'s located IO')
  .option('--host <host>', 'Modbus bind host', '0.0.0.0')
  .option('--port <port>', 'Modbus TCP port', '502')
  .action(async (file: string, opts) => {
    const { detectIO } = await import('./tools/detectIO.js')
    const { buildModbusSlaveConfig } = await import('./tools/modbusConfig.js')
    const stCode = fs.readFileSync(file, 'utf8')
    const cfg = buildModbusSlaveConfig(detectIO(stCode).io, { host: opts.host, port: parseInt(opts.port, 10) })
    console.log(JSON.stringify(cfg, null, 2))
  })

program
  .command('readVariables')
  .description('Read PLC runtime variable values (uses cached variableMap)')
  .option('--names <names>', 'comma-separated variable names (default: all)')
  .option('--timeoutMs <ms>', 'WebSocket read timeout', '5000')
  .action(async (opts) => {
    const { handleReadVariables } = await import('./tools/readVariables.js')
    const cfg = loadConfig()
    const varNames = opts.names ? String(opts.names).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
    const result = await handleReadVariables({ varNames, timeoutMs: parseInt(opts.timeoutMs, 10) }, cfg)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  })

// Coerce a CLI string into the value type force/waitFor expect:
// true/false → boolean, numeric → number, anything else stays a string.
function parseCliValue(raw: string): number | boolean | string {
  if (raw === 'true') return true
  if (raw === 'false') return false
  const n = Number(raw)
  return raw.trim() !== '' && Number.isFinite(n) ? n : raw
}

program
  .command('buildAndRun <file>')
  .description('Compile ST file, upload to runtime and start the PLC (full deploy loop)')
  .action(async (file: string) => {
    const { handleBuildAndRun } = await import('./tools/buildAndRun.js')
    const { handleUpload } = await import('./tools/upload.js')
    const { handleStart } = await import('./tools/start.js')
    const cfg = loadConfig()
    const client = new RuntimeClient(cfg.url, cfg.user, cfg.password)
    const stCode = fs.readFileSync(file, 'utf8')
    const result = await handleBuildAndRun({ stCode }, {
      compile: (i) => handleCompile(i, cfg),
      upload: () => handleUpload({} as Record<string, never>, cfg),
      start: () => handleStart(client),
    })
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  })

program
  .command('force')
  .description('Force / release runtime variables (input simulation), e.g. --set start_btn=true,setpoint=42')
  .option('--set <pairs>', 'comma-separated name=value pairs to force')
  .option('--release <names>', 'comma-separated variable names to release')
  .option('--pulseMs <ms>', 'auto-release the forced set after this many ms (wall-clock pulse)')
  .option('--pulseScans <n>', 'tick-verified pulse: hold until the runtime scanned ≥ n cycles, then release')
  .option('--timeoutMs <ms>', 'WebSocket timeout', '5000')
  .action(async (opts) => {
    const { handleForceVariables } = await import('./tools/forceVariables.js')
    const cfg = loadConfig()
    let set: Record<string, number | boolean | string> | undefined
    if (opts.set) {
      set = {}
      for (const pair of String(opts.set).split(',')) {
        const eq = pair.indexOf('=')
        if (eq <= 0) {
          console.error(`invalid --set entry "${pair}" (expected name=value)`)
          process.exit(2)
        }
        set[pair.slice(0, eq).trim()] = parseCliValue(pair.slice(eq + 1).trim())
      }
    }
    const release = opts.release ? String(opts.release).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
    const result = await handleForceVariables({
      set,
      release,
      timeoutMs: parseInt(opts.timeoutMs, 10),
      ...(opts.pulseMs ? { pulseMs: parseInt(opts.pulseMs, 10) } : {}),
      ...(opts.pulseScans ? { pulseScans: parseInt(opts.pulseScans, 10) } : {}),
    }, cfg)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  })

program
  .command('trace')
  .description('Sample variables over time (verify timers / state machines / counters)')
  .option('--names <names>', 'comma-separated variable names (default: whole variableMap)')
  .option('--intervalMs <ms>', 'spacing between samples', '200')
  .option('--durationMs <ms>', 'total trace duration', '2000')
  .option('--samples <n>', 'exact sample count (overrides durationMs)')
  .option('--timeoutMs <ms>', 'per-sample WebSocket timeout', '2000')
  .action(async (opts) => {
    const { handleTrace } = await import('./tools/trace.js')
    const cfg = loadConfig()
    const varNames = opts.names ? String(opts.names).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined
    const result = await handleTrace({
      varNames,
      intervalMs: parseInt(opts.intervalMs, 10),
      durationMs: parseInt(opts.durationMs, 10),
      ...(opts.samples ? { samples: parseInt(opts.samples, 10) } : {}),
      timeoutMs: parseInt(opts.timeoutMs, 10),
    }, cfg)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  })

program
  .command('waitFor <varName> <op> <value>')
  .description('Poll a variable until the comparison holds, e.g. waitFor red_led eq true (ops: eq ne gt ge lt le, or quoted == != > >= < <=)')
  .option('--timeoutMs <ms>', 'total wait budget', '5000')
  .option('--intervalMs <ms>', 'poll spacing', '200')
  .action(async (varName: string, rawOp: string, value: string, opts) => {
    const { handleWaitFor } = await import('./tools/waitFor.js')
    const OPS = ['==', '!=', '>', '>=', '<', '<='] as const
    // Word aliases: the symbol forms are shell-hostile (zsh expands `==`,
    // `>`/`<` are redirections), so eq/ne/gt/ge/lt/le work unquoted.
    const ALIAS: Record<string, (typeof OPS)[number]> = { eq: '==', ne: '!=', gt: '>', ge: '>=', lt: '<', le: '<=' }
    const op = ALIAS[rawOp] ?? rawOp
    if (!(OPS as readonly string[]).includes(op)) {
      console.error(`invalid op "${rawOp}" (expected one of ${Object.keys(ALIAS).join(' ')} or quoted ${OPS.join(' ')})`)
      process.exit(2)
    }
    const cfg = loadConfig()
    const result = await handleWaitFor({
      varName,
      op: op as (typeof OPS)[number],
      value: parseCliValue(value),
      timeoutMs: parseInt(opts.timeoutMs, 10),
      intervalMs: parseInt(opts.intervalMs, 10),
    }, cfg)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.success ? 0 : 1)
  })

program
  .command('genScene <file>')
  .description('Auto-suggest a process-simulation Scene Spec from an ST file\'s located IO')
  .action(async (file: string) => {
    const { detectIO } = await import('./tools/detectIO.js')
    const { suggestScene } = await import('./tools/suggestScene.js')
    const stCode = fs.readFileSync(file, 'utf8')
    console.log(JSON.stringify(suggestScene(detectIO(stCode).io), null, 2))
  })

program.parse()
