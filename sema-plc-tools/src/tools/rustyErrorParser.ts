import type { RustyError } from '../types.js'

// Remove ANSI SGR color escape sequences (rusty colorizes its diagnostics).
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

// Parse rusty codespan diagnostics. Each error is a `error[Exxx]: message` line
// followed (within a few lines) by a `┌─ <file>:<line>:<col>` location line.
export function parseRustyErrors(raw: string): RustyError[] {
  const lines = stripAnsi(raw).split('\n')
  const headRe = /error\[(E\d+)\]:\s*(.+?)\s*$/
  const locRe = /┌─\s*(?:.+?):(\d+):(\d+)/
  const errors: RustyError[] = []
  for (let i = 0; i < lines.length; i++) {
    const h = headRe.exec(lines[i])
    if (!h) continue
    let line: number | null = null
    let col: number | null = null
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const locMatch = locRe.exec(lines[j])
      if (locMatch) { line = parseInt(locMatch[1], 10); col = parseInt(locMatch[2], 10); break }
    }
    errors.push({ code: h[1], message: h[2].trim(), line, col })
  }
  return errors
}
