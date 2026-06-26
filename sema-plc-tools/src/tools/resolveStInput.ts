import * as fs from 'fs'
import * as path from 'path'

export interface ResolveStResult {
  stCode: string | null
  bothGiven: boolean   // both stCode AND stPath were supplied (stPath wins)
  error: string | null
}

/**
 * Resolve the ST source for a tool call from either inline `stCode` or a file
 * `stPath`. stPath wins when both are given. Relative stPath resolves against
 * cfg.workspace (PLC_WORKSPACE) else process.cwd(). When cfg.workspace is set,
 * the resolved path MUST stay inside it (tool-layer sandbox vs ../../ escapes
 * and out-of-workspace absolute paths); without a workspace (CLI/benchmark) no
 * containment is enforced. Pure except for the single readFileSync.
 */
export function resolveStInput(
  input: { stCode?: string; stPath?: string },
  cfg: { workspace?: string },
): ResolveStResult {
  const hasCode = typeof input.stCode === 'string' && input.stCode.trim() !== ''
  const hasPath = typeof input.stPath === 'string' && input.stPath.trim() !== ''

  if (hasPath) {
    const root = cfg.workspace ?? process.cwd()
    const abs = path.resolve(root, input.stPath as string)
    if (cfg.workspace) {
      const inside = abs === root || abs.startsWith(root + path.sep)
      if (!inside) return { stCode: null, bothGiven: hasCode, error: `stPath 越出工作区(escapes workspace): ${input.stPath}` }
    }
    try {
      const stCode = fs.readFileSync(abs, 'utf8')
      return { stCode, bothGiven: hasCode, error: null }
    } catch (e) {
      return { stCode: null, bothGiven: hasCode, error: `读取 stPath 失败: ${abs}: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  if (hasCode) return { stCode: input.stCode as string, bothGiven: false, error: null }
  return { stCode: null, bothGiven: false, error: 'stCode 或 stPath 至少提供一个(非空)' }
}
