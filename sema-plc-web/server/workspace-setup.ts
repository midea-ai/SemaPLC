import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { safePath } from './pathSafety.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// templates/ lives alongside server/ in dev (tsx) and alongside dist-server/ after build
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'templates')

/**
 * 解析 plc-tools 的 cli.js 绝对路径。开源版按仓库相对布局计算:
 * sema-plc-web 与 sema-plc-tools 同为仓库根下的兄弟目录。
 * dev(tsx)时 __dirname = sema-plc-web/server;build 后 = sema-plc-web/dist-server。
 * 两种情况下 `../../sema-plc-tools/dist/cli.js` 都落在仓库根下的 sema-plc-tools。
 * 可用 PLC_TOOLS_DIST 环境变量覆盖(指向 plc-tools 的 dist 目录)。
 */
export function resolvePlcToolsCli(): string {
  const distOverride = process.env.PLC_TOOLS_DIST
  if (distOverride) return path.join(path.resolve(distOverride), 'cli.js')
  return path.resolve(__dirname, '..', '..', 'sema-plc-tools', 'dist', 'cli.js')
}

/** 模板占位替换:__WORKSPACE__(工作区绝对路径)、__PLC_TOOLS_CLI__(plc-tools dist/cli.js 绝对路径)。 */
export function substituteTokens(content: string, workspaceRoot: string): string {
  let out = content.replaceAll('__WORKSPACE__', workspaceRoot)
  const cli = resolvePlcToolsCli()
  if (cli) {
    out = out.replaceAll('__PLC_TOOLS_CLI__', cli)
  } else if (out.includes('__PLC_TOOLS_CLI__')) {
    // 解析失败时保留占位符——静默注入空串会产生 "node  verify" 这种难懂的坏命令
    console.error('[workspace-setup] __PLC_TOOLS_CLI__ 无法解析(模板 .mcp.json 缺 plc-tools args[0]),占位符保留')
  }
  return out
}

/**
 * If $WORKSPACE doesn't have .sema/.mcp.json yet, copy templates/ into it
 * (substituting __WORKSPACE__ placeholder in .mcp.json with the absolute path).
 * Also creates $WORKSPACE/.plc-vis/ for state.json.
 *
 * Idempotent: skips files that already exist.
 * 已存在的文件不会被覆盖——模板更新后旧 workspace 拿不到新文件,验收/复测前用全新 WORKSPACE 或 cleanWorkspace()。
 */
export function setupWorkspaceIfNeeded(workspace: string): { created: string[]; skipped: string[] } {
  const created: string[] = []
  const skipped: string[] = []

  fs.mkdirSync(safePath(workspace), { recursive: true })
  fs.mkdirSync(safePath(path.join(workspace, '.plc-vis'), workspace), { recursive: true })

  copyRecursive(TEMPLATES_DIR, workspace, workspace, created, skipped)
  // Repair a stale plc-tools cli path in workspaces seeded before a path change
  // (e.g. 产品维度重构把 plc-tools 从 W1-D4-D5/... 移到 sema-plc-tools/)。否则
  // 旧 workspace 的 .mcp.json args[0] 指向已不存在的 cli.js → MCP spawn MODULE_NOT_FOUND。
  reconcileMcpCliPath(workspace)
  // Reconcile the Modbus switch from the server's startup env into the MCP env
  // block (sema-core launches plc-tools with ONLY this env, not the parent's).
  reconcileMcpModbusPort(workspace, process.env.PLC_MODBUS_PORT)

  const cli = resolvePlcToolsCli()
  if (!cli || !fs.existsSync(safePath(cli))) {
    console.error(`[workspace-setup] plc-tools dist 不存在: ${cli || '(unresolved)'} — 先到 plc-tools 目录 npm run build`)
  }

  return { created, skipped }
}

/**
 * Set/clear PLC_MODBUS_PORT in the workspace's .sema/.mcp.json plc-tools env block,
 * from the given port (the plc-vis-web startup env). When set, plc-tools bundles a
 * modbus_slave config into each program ZIP so OpenPLC exposes Modbus (for FUXA);
 * unset removes the key (switch off). Must run before sema-core reads .mcp.json.
 * Idempotent and a no-op if the file/env block is absent.
 */
export function reconcileMcpModbusPort(workspace: string, port: string | undefined): void {
  const mcpPath = safePath(path.join(workspace, '.sema', '.mcp.json'), workspace)
  if (!fs.existsSync(mcpPath)) return
  let json: { mcpServers?: Record<string, { env?: Record<string, string> }> }
  try {
    json = JSON.parse(fs.readFileSync(mcpPath, 'utf8'))
  } catch {
    return  // malformed — leave it alone
  }
  const env = json.mcpServers?.['plc-tools']?.env
  if (!env) return

  const parsed = port ? parseInt(port, 10) : NaN
  const desired = Number.isFinite(parsed) ? String(parsed) : undefined
  if (env.PLC_MODBUS_PORT === desired) return  // no change
  if (desired === undefined) delete env.PLC_MODBUS_PORT
  else env.PLC_MODBUS_PORT = desired
  fs.writeFileSync(mcpPath, JSON.stringify(json, null, 2) + '\n')
}

/**
 * Repair the workspace's .sema/.mcp.json plc-tools args[0] (cli.js absolute path)
 * to the current single source of truth (template args[0]). Existing workspaces
 * seeded before a path change keep a stale path that no longer exists → MCP spawn
 * fails with MODULE_NOT_FOUND. Reconciling on every startup self-heals them.
 * Safety: never clobber with an unresolved/placeholder/missing path. Idempotent.
 */
export function reconcileMcpCliPath(workspace: string): void {
  const cli = resolvePlcToolsCli()
  if (!cli || cli.includes('__') || !fs.existsSync(safePath(cli))) return  // unresolved / placeholder / missing → leave as-is
  const mcpPath = safePath(path.join(workspace, '.sema', '.mcp.json'), workspace)
  if (!fs.existsSync(mcpPath)) return
  let json: { mcpServers?: Record<string, { args?: string[] }> }
  try {
    json = JSON.parse(fs.readFileSync(mcpPath, 'utf8'))
  } catch {
    return  // malformed — leave it alone
  }
  const args = json.mcpServers?.['plc-tools']?.args
  if (!args || args.length === 0 || args[0] === cli) return  // absent or already correct
  args[0] = cli
  fs.writeFileSync(mcpPath, JSON.stringify(json, null, 2) + '\n')
}

function copyRecursive(srcDir: string, dstDir: string, workspaceRoot: string, created: string[], skipped: string[]) {
  const srcRoot = safePath(srcDir)
  if (!fs.existsSync(srcRoot)) return  // tests / packed env where templates not present
  for (const entry of fs.readdirSync(srcRoot, { withFileTypes: true })) {
    const src = safePath(path.join(srcDir, entry.name))
    const dst = safePath(path.join(dstDir, entry.name), workspaceRoot)  // never escape the workspace
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true })
      copyRecursive(src, dst, workspaceRoot, created, skipped)
    } else {
      if (fs.existsSync(dst)) {
        skipped.push(dst)
        continue
      }
      let content = fs.readFileSync(src, 'utf8')
      content = substituteTokens(content, workspaceRoot)
      fs.writeFileSync(dst, content)
      created.push(dst)
    }
  }
}

/**
 * Scan the workspace root for *.st files and return them sorted by mtime DESC.
 * Recurses one level into subdirs (samples/, etc.) but skips .sema, .plc-vis.
 */
// Project files surfaced in the code-tree: ST source + the YAML/JSON/TOML config
// (io_map, plc, tasks, fuxa_project). Auto-open / Run still target .st (see sema-bridge).
const PROJECT_EXT = ['.st', '.yaml', '.yml', '.json', '.toml']
export function isProjectFile(name: string): boolean {
  return PROJECT_EXT.some((e) => name.endsWith(e))
}

export function scanStFiles(workspace: string): Array<{ path: string; mtime: number }> {
  return scanFiles(workspace, (n) => n.endsWith('.st'))
}
export function scanProjectFiles(workspace: string): Array<{ path: string; mtime: number }> {
  return scanFiles(workspace, isProjectFile)
}

function scanFiles(workspace: string, match: (name: string) => boolean): Array<{ path: string; mtime: number }> {
  const out: Array<{ path: string; mtime: number }> = []
  walk(workspace, workspace, 0, out, match)
  return out.sort((a, b) => b.mtime - a.mtime)
}

function walk(dir: string, root: string, depth: number, out: Array<{ path: string; mtime: number }>, match: (name: string) => boolean) {
  if (depth > 2) return
  const dirSafe = safePath(dir)
  if (!fs.existsSync(dirSafe)) return
  for (const entry of fs.readdirSync(dirSafe, { withFileTypes: true })) {
    // .sema(skill 正文 + 深档:plan-schema/st-patterns)、build、node_modules 都不进文件树
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build') continue
    const full = safePath(path.join(dir, entry.name))
    if (entry.isDirectory()) {
      walk(full, root, depth + 1, out, match)
    } else if (match(entry.name)) {
      out.push({ path: full, mtime: fs.statSync(full).mtimeMs })
    }
  }
}

export function readStFile(filePath: string): string {
  return fs.readFileSync(safePath(filePath), 'utf8')
}

export function writeStFile(filePath: string, content: string): void {
  const fp = safePath(filePath)
  fs.mkdirSync(safePath(path.dirname(fp)), { recursive: true })
  fs.writeFileSync(fp, content, 'utf8')
}

/**
 * Remove all files and directories inside the workspace so
 * setupWorkspaceIfNeeded() can re-copy from templates/.
 * Uses rm -rf on each top-level entry; the workspace directory itself is preserved.
 */
export function cleanWorkspace(workspace: string): void {
  const ws = safePath(workspace)
  if (!fs.existsSync(ws)) return
  for (const entry of fs.readdirSync(ws)) {
    const full = safePath(path.join(workspace, entry), workspace)  // never rm outside the workspace
    fs.rmSync(full, { recursive: true, force: true })
  }
}
