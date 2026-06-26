import { RuntimeClient } from '../client/runtime.js'
import type { StartStopResult, PlcStatus } from '../types.js'
import { awaitStableStatus, CANONICAL_STATUSES } from './start.js'

// Retry the stop command if the runtime doesn't settle on STOPPED — OpenPLC can
// ignore a stop while the scan loop is busy (the user-reported "Stop didn't stop").
const MAX_ATTEMPTS = 3

export async function handleStop(
  client: RuntimeClient,
  opts: { maxMs?: number; pollMs?: number; requiredMatches?: number; maxNonCanonical?: number } = {},
): Promise<StartStopResult> {
  let message = ''
  let actualStatus: PlcStatus = 'EMPTY' as PlcStatus
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    message = await client.stopPlc()
    actualStatus = await awaitStableStatus(client, 'STOPPED', opts)
    if (actualStatus === 'STOPPED') break
    // Wedged runtime: re-issuing stop just re-waits on a dead scan process.
    // Same fast-fail as handleStart (forensics 2026-06-03 / held-force 2026-06-11).
    if (!CANONICAL_STATUSES.has(actualStatus)) {
      message = `runtime unresponsive (${actualStatus}) — aborted at attempt ${attempt}/${MAX_ATTEMPTS}. The OpenPLC runtime may be wedged; try restarting the container.`
      break
    }
  }
  return { success: actualStatus === 'STOPPED', requestedStatus: 'STOPPED', actualStatus, message }
}
