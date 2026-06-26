// 0x46 MB_FC_DEBUG_FETCH_RECORD client — flight-recorder readout with pagination.
//
// Wire layout is the FROZEN CONTRACT with the recorder plugin
// (sema-plc-tools/runtime/plugins/recorder/recorder.c, empirically verified on the live
// runtime). All multi-byte fields are BIG-endian on this channel (unlike the
// little-endian variable *payload* bytes inside a slot, which decode with
// decodeValue from variables.ts — the single decoding truth).
//
// Command (11 bytes, hex string like buildDebugCommand/buildForceCommand):
//   u8 0x46 | u64 from_tick | u16 max_slots          (max_slots=0 → INFO)
// Response after the runtime `46 7e` envelope:
//   kind=0x01 INFO:
//     u8 kind | u32 magic 0x52454331 "REC1" | u16 ver | u16 var_count
//     | u16 skipped | u16 decimation | u32 slot_size | u32 frames | u32 count
//     | char md5[32] | var_count × { u16 idx | u32 off | u16 size }
//   kind=0x02 FRAMES:
//     u8 kind | u16 n | u64 next_from (0 = no more) | n × { u64 tick | slot }

import { io } from 'socket.io-client'

export interface RecordHeader {
  ver: number; nrec: number; skipped: number; decimation: number
  slotSize: number; frames: number; count: number; md5: string
  vars: Array<{ idx: number; off: number; size: number }>
}
export interface RecordFrame { tick: bigint; slot: number[] }

const REC_MAGIC = 0x52454331  // "REC1"
const REC_VER = 1

// ── BE readers ──────────────────────────────────────────────────────────────
function u16(b: number[], o: number): number { return (b[o] << 8) | b[o + 1] }
function u32(b: number[], o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
}
function u64(b: number[], o: number): bigint {
  let v = 0n
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[o + i] & 0xff)
  return v
}

// Build the 0x46 command hex string: u8 0x46 | u64 BE fromTick | u16 BE maxSlots.
export function buildRecordCommand(fromTick: bigint, maxSlots: number): string {
  const bytes: number[] = [0x46]
  for (let i = 7; i >= 0; i--) bytes.push(Number((fromTick >> BigInt(8 * i)) & 0xffn))
  bytes.push((maxSlots >> 8) & 0xff, maxSlots & 0xff)
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')
}

// Parse the kind=0x01 INFO payload (envelope already stripped). Throws on
// magic/version mismatch — a wrong magic means we are NOT talking to the
// recorder contract and nothing downstream can be trusted.
export function parseRecordHeader(payload: number[]): RecordHeader {
  if (payload.length < 57) throw new Error(`record INFO too short: ${payload.length} bytes (need ≥57)`)
  if (payload[0] !== 0x01) throw new Error(`record INFO kind 0x${payload[0].toString(16)} (want 0x01)`)
  const magic = u32(payload, 1)
  if (magic !== REC_MAGIC) {
    throw new Error(`record header bad magic 0x${magic.toString(16)} (want 0x${REC_MAGIC.toString(16)} "REC1")`)
  }
  const ver = u16(payload, 5)
  if (ver !== REC_VER) throw new Error(`record header unsupported version ${ver} (want ${REC_VER})`)
  const nrec = u16(payload, 7)
  const header: RecordHeader = {
    ver, nrec,
    skipped: u16(payload, 9),
    decimation: u16(payload, 11),
    slotSize: u32(payload, 13),
    frames: u32(payload, 17),
    count: u32(payload, 21),
    md5: payload.slice(25, 57).map(c => String.fromCharCode(c)).join(''),
    vars: [],
  }
  const need = 57 + nrec * 8
  if (payload.length < need) throw new Error(`record INFO var table truncated: ${payload.length} bytes (need ${need})`)
  for (let i = 0; i < nrec; i++) {
    const o = 57 + i * 8
    header.vars.push({ idx: u16(payload, o), off: u32(payload, o + 2), size: u16(payload, o + 6) })
  }
  return header
}

// Parse a kind=0x02 FRAMES payload. nextFromTick=0n means no more frames.
export function parseRecordFrames(
  payload: number[],
  slotSize: number,
): { frames: RecordFrame[]; nextFromTick: bigint } {
  if (payload.length < 11) throw new Error(`record FRAMES too short: ${payload.length} bytes (need ≥11)`)
  if (payload[0] !== 0x02) throw new Error(`record FRAMES kind 0x${payload[0].toString(16)} (want 0x02)`)
  const n = u16(payload, 1)
  const nextFromTick = u64(payload, 3)
  const frames: RecordFrame[] = []
  let off = 11
  for (let i = 0; i < n; i++) {
    if (off + 8 + slotSize > payload.length) {
      throw new Error(`record FRAMES truncated at frame ${i}/${n} (offset ${off}, slotSize ${slotSize})`)
    }
    frames.push({ tick: u64(payload, off), slot: payload.slice(off + 8, off + 8 + slotSize) })
    off += 8 + slotSize
  }
  return { frames, nextFromTick }
}

// Strip the runtime debug envelope from a raw hex response. Success is
// `46 7e <payload>`; any other second byte is the runtime error path
// (MB_DEBUG_ERROR_OUT_OF_BOUNDS when no record reader is registered).
function stripRecordEnvelope(raw: string): number[] {
  if (!raw.trim()) throw new Error('empty 0x46 response')
  const bytes = raw.trim().split(/\s+/).map(h => parseInt(h, 16))
  if (bytes.length < 2 || bytes[0] !== 0x46) {
    throw new Error(`bad 0x46 response header: ${raw.slice(0, 30)}`)
  }
  if (bytes[1] !== 0x7e) {
    throw new Error(`recorder not armed (0x46 error 0x${bytes[1].toString(16).padStart(2, '0')})`)
  }
  return bytes.slice(2)
}

/**
 * Fetch the recording over ONE persistent debug socket: INFO (maxSlots=0) for
 * the header, then FETCH pages until next_from==0 or maxFrames collected.
 * Connection skeleton mirrors forceWhenViaSocket in variables.ts (single
 * in-flight debug_command + pending resolver, 'connected'/'connect' kickoff,
 * overall-deadline finish).
 */
export async function fetchRecording(
  baseUrl: string,
  token: string,
  opts: { fromTick: bigint; maxFrames: number; timeoutMs?: number },
): Promise<{ header: RecordHeader; frames: RecordFrame[] }> {
  const timeoutMs = opts.timeoutMs ?? 15000

  return new Promise((resolve, reject) => {
    const socket = io(`${baseUrl}/api/debug`, {
      path: '/socket.io',
      transports: ['polling'],
      auth: { token },
      rejectUnauthorized: false,
      timeout: Math.min(timeoutMs, 5000),
    } as any)

    let settled = false
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.disconnect()
      reject(err)
    }
    const succeed = (result: { header: RecordHeader; frames: RecordFrame[] }) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.disconnect()
      resolve(result)
    }
    const deadline = setTimeout(() => fail(new Error(`record fetch timed out after ${timeoutMs}ms`)), timeoutMs)

    // Sequential request/response: exactly one in-flight debug_command.
    let pending: ((raw: string | null) => void) | null = null
    socket.on('debug_response', (d: { success?: boolean; data?: string; error?: string }) => {
      const cb = pending; pending = null
      cb?.(d.success === false ? null : (d.data ?? ''))
    })

    // Duplicate-response guard (Task 2 真机实测陷阱): the polling transport can
    // re-deliver a response for an EARLIER command after we've already consumed
    // one and sent the next — the pending resolver would misattribute it. We
    // VALIDATE every response payload against what the in-flight command must
    // look like (INFO → kind 0x01; FETCH → kind 0x02 AND first frame tick ≥
    // requested fromTick). An invalid payload is treated as a stale duplicate:
    // drop it, re-arm the resolver, and wait for the real response (once).
    const request = (command: string, valid: (payload: number[]) => boolean): Promise<number[]> =>
      new Promise((res, rej) => {
        let retriesLeft = 1
        const arm = () => {
          pending = (raw) => {
            if (raw == null) return rej(new Error('debug command failed (runtime reported error)'))
            let payload: number[]
            try {
              payload = stripRecordEnvelope(raw)
            } catch (e) {
              return rej(e as Error)
            }
            if (!valid(payload)) {
              if (retriesLeft-- > 0) { arm(); return }  // stale duplicate — wait for the real one
              return rej(new Error('mismatched 0x46 response (duplicate delivery?) after retry'))
            }
            res(payload)
          }
        }
        arm()
        socket.emit('debug_command', { command })
      })

    const run = async () => {
      try {
        // 1. INFO — header + slot geometry
        const infoPayload = await request(buildRecordCommand(0n, 0), p => p[0] === 0x01)
        const header = parseRecordHeader(infoPayload)

        // 2. FETCH pages until exhausted or maxFrames collected
        const frames: RecordFrame[] = []
        let from = opts.fromTick
        while (!settled && frames.length < opts.maxFrames) {
          const fromReq = from
          const want = Math.min(opts.maxFrames - frames.length, 0xffff)
          const payload = await request(buildRecordCommand(fromReq, want), p => {
            if (p[0] !== 0x02) return false
            const n = u16(p, 1)
            // Monotonicity: frames at tick < from_tick are filtered server-side,
            // so a first frame below fromReq can only be a stale duplicate.
            return n === 0 || u64(p, 11) >= fromReq
          })
          const page = parseRecordFrames(payload, header.slotSize)
          frames.push(...page.frames)
          if (page.nextFromTick === 0n) break
          // next_from is the tick of the first frame that did NOT fit — ask for
          // it inclusively (server keeps t ≥ from_tick).
          if (page.frames.length === 0 && page.nextFromTick === fromReq) {
            // No progress possible (single frame wider than the response cap).
            break
          }
          from = page.nextFromTick
        }
        succeed({ header, frames: frames.slice(0, opts.maxFrames) })
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)))
      }
    }

    let started = false
    const kickoff = () => { if (!started && !settled) { started = true; void run() } }
    socket.on('connected', kickoff)
    socket.on('connect', () => setTimeout(kickoff, 100))
    socket.on('connect_error', (err: Error) => fail(new Error(`WebSocket connect failed: ${err.message}`)))
  })
}
