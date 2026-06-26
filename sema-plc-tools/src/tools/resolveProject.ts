import * as fs from 'fs'
import * as path from 'path'
import { resolveStInput } from './resolveStInput.js'
import { parseUnits, combineUnits, translateErrorLine, type CombineResult } from './stCombiner.js'

export interface ResolveProjectInput {
  stCode?: string
  stPath?: string
  stPaths?: string[]
  projectDir?: string
}

export interface ResolveProjectResult {
  stCode: string | null
  entryPath: string | null
  combine: CombineResult | null   // null for the single-file path
  error: string | null
}

// Same containment rule as resolveStInput: when workspace is set, the resolved
// absolute path must stay inside it. Returns the abs path or an error string.
function resolveInside(rel: string, root: string | undefined): { abs: string; error: string | null } {
  const base = root ?? process.cwd()
  const abs = path.resolve(base, rel)
  if (root && !(abs === root || abs.startsWith(root + path.sep))) {
    return { abs, error: `路径越出工作区(escapes workspace): ${rel}` }
  }
  return { abs, error: null }
}

function readFiles(rels: string[], root: string | undefined): { files: { path: string; content: string }[]; error: string | null } {
  const files: { path: string; content: string }[] = []
  for (const rel of rels) {
    const { abs, error } = resolveInside(rel, root)
    if (error) return { files: [], error }
    let buf: Buffer
    try { buf = fs.readFileSync(abs) } catch (e) { return { files: [], error: `读取文件失败: ${rel}: ${e instanceof Error ? e.message : String(e)}` } }
    // UTF-8 guard: reject files with invalid byte sequences early.
    const content = buf.toString('utf8')
    if (Buffer.from(content, 'utf8').length !== buf.length) return { files: [], error: `文件非 UTF-8,请转存: ${rel}` }
    files.push({ path: rel, content })
  }
  return { files, error: null }
}

/**
 * Resolve the compilation source from single-file (stCode|stPath) OR multi-file
 * (stPaths in order / projectDir single-level *.st). Multi-file goes through the
 * pure st_combiner. Every failure path returns `error` (never throws).
 */
export function resolveProject(input: ResolveProjectInput, cfg: { workspace?: string }): ResolveProjectResult {
  const multi = (input.stPaths && input.stPaths.length > 0) || (typeof input.projectDir === 'string' && input.projectDir.trim() !== '')

  if (!multi) {
    const r = resolveStInput({ stCode: input.stCode, stPath: input.stPath }, cfg)
    return { stCode: r.stCode, entryPath: input.stPath ?? null, combine: null, error: r.error }
  }

  let rels: string[]
  if (input.stPaths && input.stPaths.length > 0) {
    rels = input.stPaths
  } else {
    const { abs, error } = resolveInside(input.projectDir as string, cfg.workspace)
    if (error) return { stCode: null, entryPath: null, combine: null, error }
    let names: string[]
    try {
      names = fs.readdirSync(abs, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith('.st') && !d.name.startsWith('.'))
        .map(d => d.name).sort()
    } catch (e) {
      return { stCode: null, entryPath: null, combine: null, error: `读取目录失败: ${input.projectDir}: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (names.length === 0) return { stCode: null, entryPath: null, combine: null, error: `${input.projectDir} 下没有 .st 文件` }
    rels = names.map(n => path.join(input.projectDir as string, n))
  }

  const { files, error } = readFiles(rels, cfg.workspace)
  if (error) return { stCode: null, entryPath: null, combine: null, error }

  const combine = combineUnits(parseUnits(files))
  if (!combine.ok) return { stCode: null, entryPath: null, combine, error: combine.errors.join('; ') }
  return { stCode: combine.combined, entryPath: combine.entryPath, combine, error: null }
}

/**
 * Resolve a scene from a JSON file path: same workspace-containment rule as the
 * ST resolvers (rejects ../../ escapes), then read + JSON.parse. Reuses
 * resolveInside — no new fs/sandbox logic. Returns { scene, error } (never throws).
 */
export function resolveScene(scenePath: string, cfg: { workspace?: string }): { scene: unknown; error: string | null } {
  const { abs, error } = resolveInside(scenePath, cfg.workspace)
  if (error) return { scene: null, error }
  let raw: string
  try {
    raw = fs.readFileSync(abs, 'utf8')
  } catch (e) {
    return { scene: null, error: `读取 scenePath 失败: ${scenePath}: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    return { scene: JSON.parse(raw), error: null }
  } catch (e) {
    return { scene: null, error: `scenePath JSON 解析失败: ${scenePath}: ${e instanceof Error ? e.message : String(e)}` }
  }
}

export { translateErrorLine }
