import type { DetectedIO, DetectIOResult, ModbusType } from '../types.js'

// Located-variable declaration: `name AT %<loc> : TYPE`.
// <loc> = prefix(I|Q|M) + size(X|B|W|D|L) + digits, optionally `.bit` for X.
const AT_DECL_RE = /(\w+)\s+AT\s+(%[IQM][XBWDL]\d[\d.]*)\s*(?::\s*([A-Za-z_]\w*))?/gi

function directionFor(prefix: string): DetectedIO['direction'] {
  if (prefix === 'I') return 'input'
  if (prefix === 'Q') return 'output'
  return 'memory'
}

// Map an IEC located address to its Modbus type + address per OpenPLC rules (§10.3):
//   %IX → discrete_input, %QX → coil  (addr = byte*8 + bit)
//   %IW → input_register, %QW → holding_register  (addr = word number)
// Returns nulls for any other class (memory %M*, %IB/%ID byte/dword forms, …).
function mapModbus(prefix: string, size: string, nums: number[]): { modbusType: ModbusType | null; modbusAddr: number | null } {
  if (size === 'X') {
    const [byte, bit = 0] = nums
    const addr = byte * 8 + bit
    if (prefix === 'I') return { modbusType: 'discrete_input', modbusAddr: addr }
    if (prefix === 'Q') return { modbusType: 'coil', modbusAddr: addr }
  } else if (size === 'W') {
    const word = nums[0]
    if (prefix === 'I') return { modbusType: 'input_register', modbusAddr: word }
    if (prefix === 'Q') return { modbusType: 'holding_register', modbusAddr: word }
  }
  return { modbusType: null, modbusAddr: null }
}

// Strip ST comments — block `(* … *)` (possibly multiline) and line `// …` — so a
// `:=` inside a comment isn't mistaken for a real assignment.
function stripStComments(src: string): string {
  return src.replace(/\(\*[\s\S]*?\*\)/g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

/**
 * Find declared `%Q*` located OUTPUTS that the program body never assigns
 * (no `<name> :=` anywhere) — a "dead output": it compiles fine but stays at its
 * init value at runtime, so the actuator (conveyor/motor/lamp…) never acts. This
 * is the machine-decidable core of the spec-review "every output needs a driver"
 * rule (P0b); `plc_compile` hard-gates on it. Pure and deterministic.
 *
 * Conservative: a single LHS `:=` anywhere (any branch) clears the name — we flag
 * only ZERO assignments, which keeps false positives near nil (assignment is exact
 * ST syntax, unlike name/heuristic sniffing). Case-insensitive (IEC identifiers are).
 */
export function findUnassignedOutputs(stCode: string): string[] {
  const body = stripStComments(stCode)
  return detectIO(stCode).io
    .filter(e => e.direction === 'output')
    .filter(e => !new RegExp(`\\b${e.name}\\b\\s*:=`, 'i').test(body))
    .map(e => e.name)
}

/**
 * Extract the located-IO surface from ST source by scanning `AT %…` declarations.
 * Pure and deterministic — no compiler/Docker needed. AT declarations are the
 * authoritative IO source (matiec's LOCATED_VARIABLES.h is derived from them).
 * First occurrence of a name wins; source order is preserved.
 */
export function detectIO(stCode: string): DetectIOResult {
  const io: DetectedIO[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  AT_DECL_RE.lastIndex = 0
  while ((m = AT_DECL_RE.exec(stCode)) !== null) {
    const name = m[1]
    if (seen.has(name)) continue
    seen.add(name)

    const address = m[2].toUpperCase()
    const type = (m[3] ?? '').toUpperCase()
    const prefix = address[1]               // I | Q | M
    const size = address[2]                 // X | B | W | D | L
    const nums = address.slice(3).split('.').map(n => parseInt(n, 10))

    io.push({
      name,
      address,
      type,
      direction: directionFor(prefix),
      ...mapModbus(prefix, size, nums),
    })
  }
  return { io, count: io.length }
}
