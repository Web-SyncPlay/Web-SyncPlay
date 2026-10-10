import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/contracts/types"

/** Process-local fallback when Redis INCR is unavailable (tests / blips). */
const presenceSeqFallback = new Map<string, number>()

/** Test-only: clear process-local presenceSeq fallback counters. */
export function resetPresenceSeqFallbackForTests() {
  presenceSeqFallback.clear()
}

export function clearPresenceSeqFallback(roomId: string) {
  presenceSeqFallback.delete(roomId)
}

/**
 * Current presence revision without incrementing (for snapshots).
 * Falls back to the process-local counter, else 0.
 */
export async function peekPresenceRevision(roomId: string): Promise<number> {
  try {
    const client = await getCommandClient()
    const raw = await client.get(keys.roomPresenceSeq(roomId))
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
  } catch {
    // Redis blip — use process-local fallback below.
  }
  return presenceSeqFallback.get(roomId) ?? 0
}

/**
 * Cluster-monotonic presence revision via Redis INCR.
 * Capture-only tests and Redis blips fall back to a process-local counter.
 */
export async function nextPresenceRevision(
  roomId: string,
  options: { captureOnly: boolean },
): Promise<number> {
  if (!options.captureOnly) {
    try {
      const client = await getCommandClient()
      const seqKey = keys.roomPresenceSeq(roomId)
      const revision = Number(await client.incr(seqKey))
      await client.expire(seqKey, roomStateTtlSeconds)
      if (Number.isFinite(revision) && revision > 0) {
        return revision
      }
    } catch {
      // Redis blips: process-local fallback (not cluster-monotonic).
    }
  }
  const fallback = (presenceSeqFallback.get(roomId) ?? 0) + 1
  presenceSeqFallback.set(roomId, fallback)
  return fallback
}
