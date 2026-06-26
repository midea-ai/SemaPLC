import { RuntimeClient } from '../client/runtime.js'
import type { StartStopResult, PlcStatus } from '../types.js'

/**
 * Wait until the PLC reports the target status for `requiredMatches` consecutive
 * reads (default 2), polling every `pollMs` ms. Returns whatever was last
 * observed if `maxMs` expires without stabilising.
 *
 * OpenPLC's REST endpoints (/api/start-plc, /api/stop-plc) are asynchronous on
 * the runtime side: the HTTP response acknowledges the request, but the actual
 * scan-loop transition takes anywhere from 200 ms to ~1 s, during which a
 * single status snapshot can show INIT / ERROR / the previous state. A single
 * post-request status read therefore races with the transition and frequently
 * returns the wrong answer.
 */
// OpenPLC's /api/status may return non-canonical strings while the runtime is
// restarting (typically "No response from runtime"). Those are transient and
// must NOT count toward the "stable wrong state" early-exit — otherwise we
// give up before the runtime has finished its swap.
export const CANONICAL_STATUSES: ReadonlySet<string> = new Set([
  'EMPTY', 'INIT', 'RUNNING', 'STOPPED', 'ERROR',
])

export async function awaitStableStatus(
  client: RuntimeClient,
  target: PlcStatus,
  opts: { maxMs?: number; pollMs?: number; requiredMatches?: number; maxNonCanonical?: number } = {},
): Promise<PlcStatus> {
  // 15 s default — covers the typical compile+upload+restart cycle on OpenPLC
  // (we observed 6-9 s in production). Tests can pass a tight maxMs.
  const maxMs = opts.maxMs ?? 15000
  const pollMs = opts.pollMs ?? 250
  const requiredMatches = opts.requiredMatches ?? 2
  // After this many CONSECUTIVE non-canonical reads ("No response from runtime"),
  // declare the runtime wedged and bail — re-waiting the full maxMs won't help a
  // dead scan process. 32 × 250 ms ≈ 8 s tolerates a brief restart transient while
  // capping the wedged case (otherwise start would burn 3 × 15 s = 45 s, pushing
  // buildAndRun past the 60 s MCP request timeout). See forensics 2026-06-03.
  const maxNonCanonical = opts.maxNonCanonical ?? 32
  const start = Date.now()
  let lastSeen: PlcStatus = 'EMPTY' as PlcStatus
  let consecutiveMatch = 0
  let consecutiveWrongSame = 0
  let consecutiveNonCanonical = 0
  let prevWrong: PlcStatus | null = null
  while (Date.now() - start < maxMs) {
    try {
      const s = (await client.getStatus()) as PlcStatus
      lastSeen = s
      if (s === target) {
        consecutiveMatch++
        consecutiveWrongSame = 0
        consecutiveNonCanonical = 0
        prevWrong = null
        if (consecutiveMatch >= requiredMatches) return s
      } else if (!CANONICAL_STATUSES.has(s)) {
        // Non-canonical (e.g. "No response from runtime"). Brief during a restart
        // transient, but PERSISTENT means the runtime is wedged — bail then.
        consecutiveMatch = 0
        consecutiveWrongSame = 0
        prevWrong = null
        consecutiveNonCanonical++
        if (consecutiveNonCanonical >= maxNonCanonical) return s
      } else {
        consecutiveMatch = 0
        consecutiveNonCanonical = 0
        if (s === prevWrong) consecutiveWrongSame++
        else { consecutiveWrongSame = 1; prevWrong = s }
        // Stable in a canonical but non-target state — e.g. EMPTY (no program loaded)
        // or STOPPED (start rejected). No point waiting further.
        if (consecutiveWrongSame >= requiredMatches + 1) return s
      }
    } catch {
      consecutiveMatch = 0
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return lastSeen
}

// OpenPLC sometimes ignores a start/stop request if the runtime is mid-scan or
// busy reloading. Re-issuing the request after a failed settle usually takes.
// We retry up to MAX_ATTEMPTS, re-sending the command each time, before giving up.
const MAX_ATTEMPTS = 3

export async function handleStart(
  client: RuntimeClient,
  opts: { maxMs?: number; pollMs?: number; requiredMatches?: number; maxNonCanonical?: number } = {},
): Promise<StartStopResult> {
  let message = ''
  let actualStatus: PlcStatus = 'EMPTY' as PlcStatus
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    message = await client.startPlc()
    actualStatus = await awaitStableStatus(client, 'RUNNING', opts)
    if (actualStatus === 'RUNNING') break
    // Wedged runtime ("No response from runtime" etc.): re-issuing start just
    // re-waits on a dead scan process. Fail fast instead of burning all retries.
    if (!CANONICAL_STATUSES.has(actualStatus)) {
      message = `runtime unresponsive (${actualStatus}) — aborted at attempt ${attempt}/${MAX_ATTEMPTS}. The OpenPLC runtime may be wedged; try restarting the container.`
      break
    }
  }
  return {
    success: actualStatus === 'RUNNING',
    requestedStatus: 'RUNNING',
    actualStatus,
    message,
  }
}
