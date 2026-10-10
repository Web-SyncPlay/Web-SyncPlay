import { env } from "@/env"
import { RENEW_SCRIPT } from "@/server/media/yt-dlp/lease-lua"
import { recordYtDlpMetric } from "@/server/media/yt-dlp/metrics"
import { derivedResolveLeaseTtlSeconds } from "@/server/media/yt-dlp/policy"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { randomUUID } from "node:crypto"

function timeoutMs(): number {
  const raw = env.YTDLP_TIMEOUT_MS
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 30_000
}

function pendingSetTtlSeconds(leaseTtlSeconds: number) {
  return leaseTtlSeconds * 2
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

async function refreshPendingSetTtl(
  client: Awaited<ReturnType<typeof getCommandClient>>,
  leaseTtlSeconds: number,
) {
  await client.expire(
    keys.mediaYtDlpPendingResolves(),
    pendingSetTtlSeconds(leaseTtlSeconds),
  )
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
  const pendingKey = keys.mediaYtDlpPending(input.roomId, input.itemId)
  const member = encodePendingMember(input.roomId, input.itemId)

  try {
    const client = await getCommandClient()
    await client.sAdd(keys.mediaYtDlpPendingResolves(), member)
    await refreshPendingSetTtl(client, ttlSeconds)
    await client.set(pendingKey, "1", { EX: ttlSeconds })
    await client.set(leaseKey, owner, { EX: ttlSeconds })

    const intervalMs = Math.max(1_000, Math.floor((ttlSeconds * 1000) / 3))
    const timer = setInterval(() => {
      void client
        .eval(RENEW_SCRIPT, {
          keys: [leaseKey],
          arguments: [owner, String(ttlSeconds)],
        })
        .then((renewed) => {
          if (renewed) {
            return client.expire(pendingKey, ttlSeconds)
          }
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
  const ttlSeconds = derivedResolveLeaseTtlSeconds(timeoutMs())
  try {
    const client = await getCommandClient()
    await client.del([
      keys.mediaYtDlpResolveLease(roomId, itemId),
      keys.mediaYtDlpPending(roomId, itemId),
    ])
    await client.sRem(
      keys.mediaYtDlpPendingResolves(),
      encodePendingMember(roomId, itemId),
    )
    await refreshPendingSetTtl(client, ttlSeconds)
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
  const ttlSeconds = derivedResolveLeaseTtlSeconds(timeoutMs())
  try {
    const client = await getCommandClient()
    const members = await client.sMembers(keys.mediaYtDlpPendingResolves())
    const abandoned: AbandonedResolve[] = []
    let mutated = false

    for (const member of members) {
      const parsed = parsePendingMember(member)
      if (!parsed) {
        await client.sRem(keys.mediaYtDlpPendingResolves(), member)
        mutated = true
        continue
      }
      const leaseKey = keys.mediaYtDlpResolveLease(
        parsed.roomId,
        parsed.itemId,
      )
      const raw = await client.get(leaseKey)
      if (raw) continue

      // Lease expired — claim so only one reclaimer proceeds.
      const claimKey = keys.mediaYtDlpResolveClaim(
        parsed.roomId,
        parsed.itemId,
      )
      const claimed = await client.set(claimKey, "1", { NX: true, EX: 30 })
      if (claimed !== "OK") continue

      abandoned.push({
        roomId: parsed.roomId,
        itemId: parsed.itemId,
      })
    }

    if (mutated || members.length > 0) {
      await refreshPendingSetTtl(client, ttlSeconds)
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
