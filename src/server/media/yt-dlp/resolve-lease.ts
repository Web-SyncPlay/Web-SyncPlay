import { env } from "@/env"
import { recordYtDlpMetric } from "@/server/media/yt-dlp/metrics"
import { derivedResolveLeaseTtlSeconds } from "@/server/media/yt-dlp/policy"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { randomUUID } from "node:crypto"

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 0
`

function timeoutMs(): number {
  const raw = env.YTDLP_TIMEOUT_MS
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 30_000
}

function encodePendingMember(roomId: string, itemId: string) {
  return `${roomId}\t${itemId}`
}

export function parsePendingMember(
  member: string,
): { roomId: string; itemId: string } | null {
  const idx = member.indexOf("\t")
  if (idx <= 0 || idx === member.length - 1) return null
  return {
    roomId: member.slice(0, idx),
    itemId: member.slice(idx + 1),
  }
}

/**
 * Register a playlist resolve in Valkey so another instance can reclaim it
 * if this process dies before completion (lease TTL expires).
 */
export async function beginResolveLease(input: {
  roomId: string
  itemId: string
  sourceUrl: string
  title?: string
}): Promise<{ stop: () => void } | null> {
  const ttlSeconds = derivedResolveLeaseTtlSeconds(timeoutMs())
  const owner = randomUUID()
  const leaseKey = keys.mediaYtDlpResolveLease(input.roomId, input.itemId)

  try {
    const client = await getCommandClient()
    await client.sAdd(
      keys.mediaYtDlpPendingResolves(),
      encodePendingMember(input.roomId, input.itemId),
    )
    await client.set(leaseKey, owner, { EX: ttlSeconds })

    const intervalMs = Math.max(1_000, Math.floor((ttlSeconds * 1000) / 3))
    const timer = setInterval(() => {
      void client
        .eval(RENEW_SCRIPT, {
          keys: [leaseKey],
          arguments: [owner, String(ttlSeconds)],
        })
        .catch(() => {
          // ignore
        })
    }, intervalMs)
    timer.unref?.()

    return {
      stop: () => {
        clearInterval(timer)
        void endResolveLease(input.roomId, input.itemId)
      },
    }
  } catch {
    return null
  }
}

export async function endResolveLease(roomId: string, itemId: string) {
  try {
    const client = await getCommandClient()
    await client.del([keys.mediaYtDlpResolveLease(roomId, itemId)])
    await client.sRem(
      keys.mediaYtDlpPendingResolves(),
      encodePendingMember(roomId, itemId),
    )
  } catch {
    // ignore
  }
}

export type AbandonedResolve = {
  roomId: string
  itemId: string
}

/**
 * Pending members whose lease key is gone (holder crashed / timed out).
 */
export async function listAbandonedResolves(): Promise<AbandonedResolve[]> {
  try {
    const client = await getCommandClient()
    const members = await client.sMembers(keys.mediaYtDlpPendingResolves())
    const abandoned: AbandonedResolve[] = []

    for (const member of members) {
      const parsed = parsePendingMember(member)
      if (!parsed) {
        await client.sRem(keys.mediaYtDlpPendingResolves(), member)
        continue
      }
      const leaseKey = keys.mediaYtDlpResolveLease(
        parsed.roomId,
        parsed.itemId,
      )
      const raw = await client.get(leaseKey)
      if (raw) continue

      // Lease expired — claim so only one reclaimer proceeds.
      const claimKey = `${leaseKey}:claim`
      const claimed = await client.set(claimKey, "1", { NX: true, EX: 30 })
      if (claimed !== "OK") continue

      abandoned.push({
        roomId: parsed.roomId,
        itemId: parsed.itemId,
      })
    }

    return abandoned
  } catch {
    return []
  }
}

export async function reclaimAbandonedResolves(handlers: {
  reresolve: (job: AbandonedResolve) => Promise<boolean>
}): Promise<number> {
  const abandoned = await listAbandonedResolves()
  let reclaimed = 0
  for (const job of abandoned) {
    recordYtDlpMetric("resolveReclaim")
    try {
      const ok = await handlers.reresolve(job)
      if (ok) reclaimed += 1
      else await endResolveLease(job.roomId, job.itemId)
    } catch {
      await endResolveLease(job.roomId, job.itemId)
    }
  }
  return reclaimed
}
