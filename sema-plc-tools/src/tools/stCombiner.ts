// Multi-file ST combiner (pure: no fs / no docker). Merges TYPE / FUNCTION /
// FUNCTION_BLOCK / PROGRAM / CONFIGURATION units from several .st files into a
// single compilation unit for iec2c. matiec is multi-pass (SPIKE-1) so unit
// order is not load-bearing; layering is only for readability.

export type PouKind = 'TYPE' | 'FUNCTION' | 'FUNCTION_BLOCK' | 'PROGRAM' | 'CONFIGURATION'

/**
 * Blank out comments and string-literal contents, preserving byte length and
 * newlines so positions in the returned text map 1:1 to the original. Used only
 * for locating POU boundaries — the real body is sliced from the original.
 */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    if (src[i] === '(' && src[i + 1] === '*') {            // block (* ... *)
      out += '  '; i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === ')')) { out += src[i] === '\n' ? '\n' : ' '; i++ }
      if (i < n) { out += '  '; i += 2 }
    } else if (src[i] === '/' && src[i + 1] === '/') {      // line //
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
    } else if (src[i] === "'") {                            // string literal
      out += "'"; i++
      while (i < n && src[i] !== "'") { out += src[i] === '\n' ? '\n' : ' '; i++ }
      if (i < n) { out += "'"; i++ }
    } else { out += src[i]; i++ }
  }
  return out
}

export interface StUnit {
  path: string
  kind: PouKind
  body: string            // exact original text of the POU (opener..END inclusive)
  localStartLine: number  // 1-based line of the opener within its source file
}

export interface ParseResult { units: StUnit[]; errors: string[] }

const OPEN_ANY = /\b(FUNCTION_BLOCK|FUNCTION|PROGRAM|CONFIGURATION|TYPE)\b/gi

/**
 * Split each file into top-level POU units. Boundaries are located on the
 * comment/string-blanked text (so fake keywords inside comments/strings are
 * ignored); the body is sliced from the original. FUNCTION_BLOCK is matched
 * before FUNCTION (the alternation lists it first → longest match). An opener
 * with no matching END is fail-safe: it appends an error and that file yields no
 * units (caller must treat errors as "do not combine"). SPIKE-3 validated.
 */
export function parseUnits(files: { path: string; content: string }[]): ParseResult {
  const units: StUnit[] = []
  const errors: string[] = []
  for (const { path: p, content } of files) {
    const masked = stripComments(content)
    let pos = 0
    const fileUnits: StUnit[] = []
    let fileError = false
    while (pos < masked.length) {
      OPEN_ANY.lastIndex = pos
      const o = OPEN_ANY.exec(masked)
      if (!o) break
      const kind = o[1].toUpperCase() as PouKind
      const endRe = new RegExp('\\bEND_' + kind + '\\b', 'gi')
      endRe.lastIndex = o.index + o[0].length
      const e = endRe.exec(masked)
      if (!e) {
        errors.push(`${p}: 找到 ${kind} 但缺少匹配的 END_${kind}(无法自动切块)`)
        fileError = true
        break
      }
      const startIdx = o.index
      const endIdx = e.index + e[0].length
      const localStartLine = content.slice(0, startIdx).split('\n').length
      fileUnits.push({ path: p, kind, body: content.slice(startIdx, endIdx), localStartLine })
      pos = endIdx
    }
    // A file with any parse error contributes no units (fail-safe; combineUnits
    // then reports the missing CONFIGURATION/PROGRAM downstream).
    if (!fileError) units.push(...fileUnits)
  }
  return { units, errors }
}

export interface SourceSpan { mergedStartLine: number; lineCount: number; path: string; localStartLine: number }

export interface CombineResult {
  ok: boolean
  combined: string | null
  entryPath: string | null         // path of the CONFIGURATION unit
  errors: string[]
  warnings: string[]
  spans: SourceSpan[]
}

const LAYER_ORDER: PouKind[] = ['TYPE', 'FUNCTION', 'FUNCTION_BLOCK', 'PROGRAM', 'CONFIGURATION']

/**
 * Combine parsed units into one compilation unit. Layered by kind for
 * readability (matiec is order-independent — SPIKE-1). Enforces exactly one
 * CONFIGURATION and exactly one PROGRAM (SPIKE-2: multiple PROGRAMs collide in
 * normalizeCsv's short-name slice and silently misread). Each unit's body is
 * prefixed with a `(* SOURCE: path *)` anchor; spans map merged lines → source.
 */
export function combineUnits(parsed: ParseResult): CombineResult {
  const base: CombineResult = { ok: false, combined: null, entryPath: null, errors: [], warnings: [], spans: [] }
  if (parsed.errors.length) return { ...base, errors: [...parsed.errors] }

  const cfgs = parsed.units.filter(u => u.kind === 'CONFIGURATION')
  const progs = parsed.units.filter(u => u.kind === 'PROGRAM')
  if (cfgs.length === 0) return { ...base, errors: ['未找到 CONFIGURATION:多文件项目须恰好一个 CONFIGURATION'] }
  if (cfgs.length > 1) return { ...base, errors: [`找到 ${cfgs.length} 个 CONFIGURATION:须恰好一个`] }
  if (progs.length !== 1) return { ...base, errors: [`找到 ${progs.length} 个 PROGRAM:一期须恰好一个(多 PROGRAM 会导致变量名碰撞,见 SPIKE-2)`] }

  const ordered = LAYER_ORDER.flatMap(k => parsed.units.filter(u => u.kind === k))
  const spans: SourceSpan[] = []
  const lines: string[] = []
  for (const u of ordered) {
    lines.push(`(* SOURCE: ${u.path} *)`)                  // 1 anchor line
    const bodyLines = u.body.split('\n')
    spans.push({ mergedStartLine: lines.length + 1, lineCount: bodyLines.length, path: u.path, localStartLine: u.localStartLine })
    lines.push(...bodyLines)
    lines.push('')                                         // blank separator
  }
  return { ok: true, combined: lines.join('\n'), entryPath: cfgs[0].path, errors: [], warnings: [], spans }
}

/** Map a 1-based line in the combined text back to its source file + local line. */
export function translateErrorLine(mergedLine: number, spans: SourceSpan[]): { path: string; localLine: number } | null {
  for (const s of spans) {
    if (mergedLine >= s.mergedStartLine && mergedLine < s.mergedStartLine + s.lineCount) {
      return { path: s.path, localLine: s.localStartLine + (mergedLine - s.mergedStartLine) }
    }
  }
  return null
}
