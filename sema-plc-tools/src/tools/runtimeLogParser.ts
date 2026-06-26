import type { RuntimeError } from '../types.js'

interface Pattern {
  type: RuntimeError['type']
  regex: RegExp
  advice: string
}

const PATTERNS: Pattern[] = [
  {
    type: 'watchdog',
    regex: /watchdog\s+(timer|timeout)/i,
    advice: 'PLC scan cycle exceeded watchdog limit. Simplify program logic or increase task INTERVAL.',
  },
  {
    type: 'scan_overrun',
    regex: /\bscan\b\s*(time\s+)?overflow|\bscan_overrun\b/i,
    advice: 'Single scan took longer than task interval. Reduce per-scan work or split logic across cycles.',
  },
  {
    type: 'segfault',
    regex: /segmentation\s+fault|\bSIGSEGV\b/i,
    advice: 'C-level crash. Likely null pointer or array out-of-bounds — check pointer-style logic and array indices.',
  },
  {
    type: 'div_by_zero',
    regex: /div(?:ision|ide)\s+by\s+zero/i,
    advice: 'Division by zero. Guard the divisor (IF divisor <> 0 THEN ...) before the operation.',
  },
]

export function parseRuntimeLogs(raw: string): RuntimeError[] {
  if (!raw) return []
  const lines = raw.split('\n')
  const errors: RuntimeError[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    for (const p of PATTERNS) {
      if (p.regex.test(line)) {
        errors.push({
          type: p.type,
          message: line.trim(),
          line: i + 1,
          advice: p.advice,
        })
        break
      }
    }
  }
  return errors
}
