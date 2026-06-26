import { io } from 'socket.io-client'
import type { VariableEntry, VariableValue } from '../types.js'

// Build 0x44 DEBUG_GET_LIST command bytes as hex string
export function buildDebugCommand(indices: number[]): string {
  const count = indices.length
  const bytes: number[] = [0x44, (count >> 8) & 0xff, count & 0xff]
  for (const idx of indices) {
    bytes.push((idx >> 8) & 0xff, idx & 0xff)
  }
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

// Returns the byte size of a variable given its IEC 61131-3 type string
export function varSize(type: string): number {
  switch (type.toUpperCase()) {
    case 'BOOL': return 1
    case 'SINT': case 'USINT': case 'BYTE': return 1
    case 'INT': case 'UINT': case 'WORD': return 2
    case 'DINT': case 'UDINT': case 'DWORD': return 4
    case 'LINT': case 'ULINT': case 'LWORD': return 8
    case 'REAL': return 4
    case 'LREAL': return 8
    // IEC_TIMESPEC: { int32 tv_sec; int32 tv_nsec; } = 8 bytes (see openplc-runtime
    // /workdir/core/src/lib/iec_types.h). Same struct underlies DATE/DT/TOD.
    case 'TIME': case 'DATE': case 'DT': case 'TOD': return 8
    default: return 2
  }
}

// Parse raw hex response from MB_FC_DEBUG_GET_LIST (0x44) command.
// Response format (OpenPLC Runtime C core):
//   byte[0]   = 0x44 (command echo)
//   byte[1]   = 0x7E (success marker)
//   byte[2-3] = lastVarIdx (uint16, big-endian)
//   byte[4-7] = tick__ (uint32, big-endian, runtime timestamp)
//   byte[8-9] = responseSize (uint16, big-endian, total bytes of variable data)
//   byte[10+] = raw variable bytes concatenated (little-endian)
// Variable sizes are determined by their IEC type (BOOL=1, INT=2, REAL=4, etc.)
export function parseDebugResponse(
  raw: string,
  variables: VariableEntry[],
): Record<string, VariableValue> {
  if (!raw || variables.length === 0) return {}

  const bytes = raw.trim().split(' ').map(h => parseInt(h, 16))
  // Minimum: 10 header bytes
  if (bytes.length < 10) return {}
  // Validate command (0x44) and success (0x7E) markers
  if (bytes[0] !== 0x44 || bytes[1] !== 0x7E) return {}

  const responseSize = (bytes[8] << 8) | bytes[9]
  const result: Record<string, VariableValue> = {}
  let offset = 10  // start of variable data

  for (const v of variables) {
    if (offset >= 10 + responseSize) break
    const size = varSize(v.type)
    if (offset + size > 10 + responseSize) break

    const valueBytes = bytes.slice(offset, offset + size)
    offset += size

    result[v.name] = { value: decodeValue(v.type, valueBytes), type: v.type, index: v.index, location: v.location }
  }
  return result
}

// Decode raw little-endian variable bytes per IEC 61131-3 type — the SINGLE
// decoding truth shared by parseDebugResponse (0x44 live reads) and the 0x46
// flight-recorder client (record.ts), which both deal in the same in-memory
// representations. Extracted verbatim from parseDebugResponse; behavior is
// unchanged.
export function decodeValue(type: string, valueBytes: number[]): VariableValue['value'] {
  let value: number | boolean | string = 0
  switch (type.toUpperCase()) {
    case 'BOOL':
      value = valueBytes[0] !== 0
      break
    case 'SINT':
      value = valueBytes[0] > 127 ? valueBytes[0] - 256 : valueBytes[0]
      break
    case 'USINT': case 'BYTE':
      value = valueBytes[0]
      break
    case 'INT':
    case 'WORD': {
      const u = valueBytes[0] | (valueBytes[1] << 8)
      value = type.toUpperCase() === 'INT' && u > 32767 ? u - 65536 : u
      break
    }
    case 'UINT':
      value = valueBytes[0] | (valueBytes[1] << 8)
      break
    case 'DINT': {
      const u32 = valueBytes[0] | (valueBytes[1] << 8) | (valueBytes[2] << 16) | (valueBytes[3] << 24)
      value = u32
      break
    }
    case 'UDINT': case 'DWORD':
      value = (valueBytes[0] | (valueBytes[1] << 8) | (valueBytes[2] << 16) | (valueBytes[3] << 24)) >>> 0
      break
    case 'REAL': {
      const buf = Buffer.from(valueBytes.slice(0, 4))
      value = buf.readFloatLE(0)
      break
    }
    case 'LREAL': {
      const buf = Buffer.from(valueBytes.slice(0, 8))
      value = buf.readDoubleLE(0)
      break
    }
    case 'LINT':
    case 'ULINT':
    case 'LWORD': {
      const lo = BigInt(valueBytes[0] | (valueBytes[1] << 8) | (valueBytes[2] << 16) | ((valueBytes[3] << 24) >>> 0))
      const hi = BigInt(valueBytes[4] | (valueBytes[5] << 8) | (valueBytes[6] << 16) | ((valueBytes[7] << 24) >>> 0))
      let bi = (hi << 32n) | (lo & 0xFFFFFFFFn)
      if (type.toUpperCase() === 'LINT' && (bi & (1n << 63n))) bi = bi - (1n << 64n)  // sign extend
      value = bi.toString()
      break
    }
    // OpenPLC stores IEC_TIME as IEC_TIMESPEC: { int32 tv_sec; int32 tv_nsec; },
    // 8 bytes total, both fields little-endian. DATE/DT/TOD share the same
    // struct. Return value in milliseconds (tv_sec*1000 + tv_nsec/1e6) — most
    // common Agent use case is "is timer.et > 500ms?". Precision under 1ms is
    // truncated; if needed, raw bytes are still available via direct calls.
    case 'TIME': case 'DATE': case 'DT': case 'TOD': {
      // int32 LE — sign-extend by going through Int32Array via DataView
      const buf = Buffer.from(valueBytes.slice(0, 8))
      const sec = buf.readInt32LE(0)
      const nsec = buf.readInt32LE(4)
      value = sec * 1000 + Math.round(nsec / 1_000_000)
      break
    }
    default:
      value = valueBytes[0] | (valueBytes[1] << 8)
  }
  return value
}

// Extract the runtime tick__ (byte[4-7], uint32 big-endian) from a 0x44 response.
// Returns null if the response is malformed. The tick advances once per scan cycle,
// so it orders trace samples by real scan progression (independent of wall-clock).
export function parseDebugTick(raw: string): number | null {
  if (!raw) return null
  const bytes = raw.trim().split(/\s+/).map(h => parseInt(h, 16))
  if (bytes.length < 8 || bytes[0] !== 0x44 || bytes[1] !== 0x7e) return null
  return ((bytes[4] << 24) | (bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) >>> 0
}

// Read one debug snapshot, returning both the runtime tick and the parsed values.
// readVariablesViaSockets delegates here (and discards the tick) for back-compat.
export async function readDebugSnapshot(
  baseUrl: string,
  token: string,
  variables: VariableEntry[],
  timeoutMs = 5000,
): Promise<{ tick: number | null; values: Record<string, VariableValue> }> {
  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/api/debug`, {
      path: '/socket.io',
      transports: ['polling'],
      auth: { token },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    } as any)

    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error(`WebSocket variable read timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    let commandSent = false
    const sendCommand = () => {
      if (commandSent || !socket.connected) return
      commandSent = true
      const cmd = buildDebugCommand(variables.map(v => v.index))
      socket.emit('debug_command', { command: cmd })
    }

    socket.on('connected', () => sendCommand())
    socket.on('connect', () => setTimeout(sendCommand, 100))

    socket.on('debug_response', (data: { success?: boolean; data?: string; error?: string }) => {
      clearTimeout(timer)
      socket.disconnect()
      if (data.success === false) {
        reject(new Error(`Debug command failed: ${data.error ?? 'unknown error'}`))
        return
      }
      const raw = data.data ?? ''
      resolve({ tick: parseDebugTick(raw), values: parseDebugResponse(raw, variables) })
    })

    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer)
      socket.disconnect()
      reject(new Error(`WebSocket connect failed: ${err.message}`))
    })
  })
}

export async function readVariablesViaSockets(
  baseUrl: string,
  token: string,
  variables: VariableEntry[],
  timeoutMs = 5000,
): Promise<Record<string, VariableValue>> {
  return (await readDebugSnapshot(baseUrl, token, variables, timeoutMs)).values
}

// ============================================================================
// Variable forcing (DEBUG_SET / 0x42) — write/override variable values
// ============================================================================

// Whether this matiec runtime can force a variable. EMPIRICALLY re-verified 2026-06-05
// against the live runtime (force-by-index, bypassing this gate): force_var()'s generated
// switch handles EVERY located elementary type — %I input (_P) and %Q output (_O) alike —
// and the value latches persistently (FORCE_FLAG). The earlier "only BOOL + INT_O" claim
// was a never-tested inference and was wrong (it silently blocked %IW / UINT / REAL / etc.).
// Forceable = located (%I or %Q) AND an elementary numeric/bit type serializeValue can encode.
// Internal (non-located, location '') vars are not force targets. TIME/DATE/STRING are
// excluded until empirically verified (rarely located, rarely a force target).
const FORCEABLE_TYPES = new Set([
  'BOOL', 'SINT', 'USINT', 'BYTE', 'INT', 'UINT', 'WORD',
  'DINT', 'UDINT', 'DWORD', 'REAL', 'LINT', 'ULINT', 'LWORD', 'LREAL',
])
export function isForceable(type: string, location: string): boolean {
  const isLocated = location.startsWith('%I') || location.startsWith('%Q')
  return isLocated && FORCEABLE_TYPES.has(type.toUpperCase())
}

// Serialize a JS value to little-endian bytes per IEC type. Returns null if the
// value doesn't fit the type (e.g. boolean for INT, out-of-range for SINT).
export function serializeValue(type: string, value: number | boolean | string): number[] | null {
  const T = type.toUpperCase()
  // BOOL: explicit mapping (agents commonly pass strings). Naive `value ? 1 : 0`
  // wrongly turned the string 'false' into TRUE. true/1/'1'/'true' → [1];
  // false/0/'0'/'false'/'' → [0]; anything else → reject.
  if (T === 'BOOL') {
    if (value === true || value === 1) return [1]
    if (value === false || value === 0) return [0]
    if (typeof value === 'string') {
      const s = value.trim().toLowerCase()
      if (s === '1' || s === 'true') return [1]
      if (s === '0' || s === 'false' || s === '') return [0]
    }
    return null
  }
  // Numeric types: agents often pass integer numeric strings — coerce before validation.
  const isNumericTypes =
    T === 'SINT' || T === 'USINT' || T === 'BYTE' ||
    T === 'INT' || T === 'UINT' || T === 'WORD' ||
    T === 'DINT' || T === 'UDINT' || T === 'DWORD'
  if (isNumericTypes && typeof value === 'string') {
    const s = value.trim()
    if (s !== '' && Number.isInteger(Number(s))) value = Number(s)
  }
  // REAL/LREAL: accept numeric strings (incl. decimals).
  if ((T === 'REAL' || T === 'LREAL') && typeof value === 'string') {
    const s = value.trim()
    if (s !== '' && Number.isFinite(Number(s))) value = Number(s)
  }
  // 1-byte int — validate against the *signed* range for SINT before coercing
  if (T === 'SINT' || T === 'USINT' || T === 'BYTE') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    if (T === 'SINT' && (value < -128 || value > 127)) return null
    if (T !== 'SINT' && (value < 0 || value > 255)) return null
    const v = value < 0 ? value + 256 : value
    return [v & 0xff]
  }
  // 2-byte int
  if (T === 'INT' || T === 'UINT' || T === 'WORD') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    if (T === 'INT' && (value < -32768 || value > 32767)) return null
    if (T !== 'INT' && (value < 0 || value > 65535)) return null
    const v = value < 0 ? value + 65536 : value
    return [v & 0xff, (v >> 8) & 0xff]
  }
  // 4-byte int
  if (T === 'DINT' || T === 'UDINT' || T === 'DWORD') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    if (T === 'DINT' && (value < -2147483648 || value > 2147483647)) return null
    if (T !== 'DINT' && (value < 0 || value > 0xFFFFFFFF)) return null
    const v = value < 0 ? value + 0x100000000 : value
    return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
  }
  // 4-byte float
  if (T === 'REAL') {
    if (typeof value !== 'number') return null
    const b = Buffer.alloc(4)
    b.writeFloatLE(value, 0)
    return [b[0], b[1], b[2], b[3]]
  }
  // 8-byte float
  if (T === 'LREAL') {
    if (typeof value !== 'number') return null
    const b = Buffer.alloc(8)
    b.writeDoubleLE(value, 0)
    return Array.from(b)
  }
  // 8-byte int (accept JS number or string for BigInt safety)
  if (T === 'LINT' || T === 'ULINT' || T === 'LWORD') {
    let bi: bigint
    try {
      bi = typeof value === 'string' ? BigInt(value) : BigInt(value as number)
    } catch { return null }
    // Sign extend to unsigned for serialization
    if (T === 'LINT' && bi < 0n) bi = bi + (1n << 64n)
    if (bi < 0n || bi >= (1n << 64n)) return null
    const out: number[] = []
    for (let i = 0; i < 8; i++) {
      out.push(Number(bi & 0xffn))
      bi >>= 8n
    }
    return out
  }
  // TIME / DATE / DT / TOD — accept JS number (milliseconds) and split into sec/nsec
  if (T === 'TIME' || T === 'DATE' || T === 'DT' || T === 'TOD') {
    if (typeof value !== 'number') return null
    const sec = Math.floor(value / 1000)
    const nsec = (value - sec * 1000) * 1_000_000
    const b = Buffer.alloc(8)
    b.writeInt32LE(sec, 0)
    b.writeInt32LE(nsec, 4)
    return Array.from(b)
  }
  return null
}

// Build a 0x42 DEBUG_SET command bytes as hex string.
//   [0]    0x42                command
//   [1-2]  varidx u16 BE       per debug_handler.c parsing
//   [3]    flag u8             1=force, 0=release
//   [4-5]  len   u16 BE        value byte count
//   [6..]  value bytes (LE)
export function buildForceCommand(idx: number, flag: 0 | 1, value: number[]): string {
  const len = value.length
  const bytes: number[] = [
    0x42,
    (idx >> 8) & 0xff, idx & 0xff,
    flag,
    (len >> 8) & 0xff, len & 0xff,
    ...value,
  ]
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

// Parse 0x42 response: success is 0x42 0x7E, anything else is failure.
// Returns null on success, or an error message string.
export function parseForceResponse(raw: string): string | null {
  if (!raw) return 'empty response'
  const bytes = raw.trim().split(/\s+/).map(h => parseInt(h, 16))
  if (bytes.length < 2 || bytes[0] !== 0x42) return `bad response header: ${raw.slice(0, 30)}`
  if (bytes[1] === 0x7E) return null
  // Known error codes from MB_DEBUG_ERROR_OUT_OF_BOUNDS (typically 0x80) — surface raw code
  return `runtime rejected: code 0x${bytes[1].toString(16).padStart(2, '0').toUpperCase()}`
}

/**
 * Force or release a single variable via DEBUG_SET (0x42) WebSocket command.
 * Returns null on success, or an error string. Uses a single short-lived socket.
 */
export async function forceVariableViaSocket(
  baseUrl: string,
  token: string,
  idx: number,
  flag: 0 | 1,
  valueBytes: number[],
  timeoutMs = 5000,
): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = io(`${baseUrl}/api/debug`, {
      path: '/socket.io',
      transports: ['polling'],
      auth: { token },
      rejectUnauthorized: false,
      timeout: timeoutMs,
    } as any)

    const timer = setTimeout(() => {
      socket.disconnect()
      resolve(`WebSocket force timed out after ${timeoutMs}ms`)
    }, timeoutMs)

    let commandSent = false
    const sendCommand = () => {
      if (commandSent || !socket.connected) return
      commandSent = true
      socket.emit('debug_command', { command: buildForceCommand(idx, flag, valueBytes) })
    }

    socket.on('connected', sendCommand)
    socket.on('connect', () => setTimeout(sendCommand, 100))

    socket.on('debug_response', (data: { success?: boolean; data?: string; error?: string }) => {
      clearTimeout(timer)
      socket.disconnect()
      if (data.success === false) {
        resolve(`debug command failed: ${data.error ?? 'unknown'}`)
        return
      }
      resolve(parseForceResponse(data.data ?? ''))
    })

    socket.on('connect_error', (err: Error) => {
      clearTimeout(timer)
      socket.disconnect()
      resolve(`WebSocket connect failed: ${err.message}`)
    })
  })
}

// ============================================================================
// Condition-triggered force (when-clause) — ONE persistent socket
// ============================================================================

export interface ForceWhenResult {
  met: boolean
  polls: number
  conditionValue: unknown
  tickAtMet: number | null
  tickAtForced: number | null
  forceErrors: Array<{ idx: number; error: string }>
}

// Scalar comparison mirroring plc_waitFor semantics (kept local to avoid a
// client→tools import cycle).
function cmpScalar(actual: unknown, op: string, expected: number | boolean | string): boolean {
  const a = typeof actual === 'boolean' ? (actual ? 1 : 0) : Number(actual)
  const e = typeof expected === 'boolean' ? (expected ? 1 : 0) : Number(expected)
  if (Number.isNaN(a) || Number.isNaN(e)) {
    const as = String(actual); const es = String(expected)
    return op === '==' ? as === es : op === '!=' ? as !== es : false
  }
  switch (op) {
    case '==': return a === e
    case '!=': return a !== e
    case '>':  return a > e
    case '>=': return a >= e
    case '<':  return a < e
    case '<=': return a <= e
    default:   return false
  }
}

/**
 * Poll `condVar` and, the moment the condition holds, fire all `sets` force
 * commands — over ONE already-connected debug socket. The naive
 * waitFor→forceVariables sequence loses 3-5 scans to two connection handshakes
 * (~46ms poll + ~30ms force connect); here the force is a single emit on the
 * live socket, landing within ~1 scan of the observed condition.
 */
export async function forceWhenViaSocket(
  baseUrl: string,
  token: string,
  condVar: VariableEntry,
  op: string,
  target: number | boolean | string,
  sets: Array<{ idx: number; valueBytes: number[] }>,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<ForceWhenResult> {
  const timeoutMs = opts.timeoutMs ?? 5000
  const pollMs = opts.pollMs ?? 0

  return new Promise((resolveOuter) => {
    const socket = io(`${baseUrl}/api/debug`, {
      path: '/socket.io',
      transports: ['polling'],
      auth: { token },
      rejectUnauthorized: false,
      timeout: Math.min(timeoutMs, 5000),
    } as any)

    const result: ForceWhenResult = {
      met: false, polls: 0, conditionValue: undefined,
      tickAtMet: null, tickAtForced: null, forceErrors: [],
    }
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.disconnect()
      resolveOuter(result)
    }
    const deadline = setTimeout(finish, timeoutMs)

    // Sequential request/response: exactly one in-flight debug_command; the next
    // debug_response belongs to it (the runtime answers commands in order).
    let pending: ((raw: string | null) => void) | null = null
    socket.on('debug_response', (d: { success?: boolean; data?: string; error?: string }) => {
      const cb = pending; pending = null
      cb?.(d.success === false ? null : (d.data ?? ''))
    })
    const send = (command: string): Promise<string | null> =>
      new Promise((res) => { pending = res; socket.emit('debug_command', { command }) })

    const run = async () => {
      try {
        // poll loop
        while (!settled) {
          const raw = await send(buildDebugCommand([condVar.index]))
          if (settled) return
          result.polls++
          if (raw != null) {
            const values = parseDebugResponse(raw, [condVar])
            const v = values[condVar.name]?.value
            result.conditionValue = v
            if (v !== undefined && cmpScalar(v, op, target)) {
              result.tickAtMet = parseDebugTick(raw)
              break
            }
          }
          if (pollMs > 0) await new Promise(r => setTimeout(r, pollMs))
        }
        if (settled) return

        // condition met → fire forces immediately on the SAME socket
        for (const s of sets) {
          const raw = await send(buildForceCommand(s.idx, 1, s.valueBytes))
          if (settled) return
          const err = raw == null ? 'debug command failed' : parseForceResponse(raw)
          if (err) result.forceErrors.push({ idx: s.idx, error: err })
        }
        result.met = result.forceErrors.length < sets.length || sets.length === 0

        // one more read for the post-force tick (evidence of the actual gap)
        const raw = await send(buildDebugCommand([condVar.index]))
        if (raw != null) result.tickAtForced = parseDebugTick(raw)
      } catch {
        /* fall through to finish() with whatever evidence we have */
      }
      finish()
    }

    let started = false
    const kickoff = () => { if (!started && !settled) { started = true; void run() } }
    socket.on('connected', kickoff)
    socket.on('connect', () => setTimeout(kickoff, 100))
    socket.on('connect_error', () => finish())
  })
}
