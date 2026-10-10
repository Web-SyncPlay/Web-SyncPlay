/**
 * Per-room viewer capability tokens for public local-media HTTP access (finding S4).
 *
 * Valkey: `room:{roomId}:viewer:{userId}` → `{ tokenHash, boundIp }`
 * TTL aligns with room state (`roomStateTtlSeconds`).
 *
 * Minted on join / remint on reconnect; invalidated on disconnect when presence hits zero.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/contracts/types"
import { z } from "zod"

export type ViewerCapabilityRecord = {
  tokenHash: string
  boundIp: string
}

const viewerCapabilityRecordSchema = z.object({
  tokenHash: z.string().min(1),
  boundIp: z.string().min(1),
})

export function hashViewerCapabilityToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function parseViewerCapabilityRecord(
  raw: string,
): ViewerCapabilityRecord | null {
  try {
    const parsed = viewerCapabilityRecordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function hashesEqual(a: string, b: string): boolean {
  try {
    const left = Buffer.from(a, "utf8")
    const right = Buffer.from(b, "utf8")
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

/** Mint (or remint) a viewer capability token bound to room + user + client IP. */
export async function mintViewerCapabilityToken(input: {
  roomId: string
  userId: string
  boundIp: string
}): Promise<{ token: string }> {
  const token = randomBytes(32).toString("base64url")
  const record: ViewerCapabilityRecord = {
    tokenHash: hashViewerCapabilityToken(token),
    boundIp: input.boundIp.trim() || "unknown",
  }
  const client = await getCommandClient()
  await client.set(
    keys.roomViewerCapability(input.roomId, input.userId),
    JSON.stringify(record),
    { EX: roomStateTtlSeconds },
  )
  return { token }
}

/**
 * Validate a presented token against the Valkey record for room+user.
 * Requires matching token hash, bound IP, and that the key exists.
 */
export async function validateViewerCapabilityToken(input: {
  token: string
  roomId: string
  userId: string
  clientIp: string
}): Promise<boolean> {
  const token = input.token.trim()
  const userId = input.userId.trim()
  const roomId = input.roomId.trim()
  if (!token || !userId || !roomId) return false

  const client = await getCommandClient()
  const raw = await client.get(keys.roomViewerCapability(roomId, userId))
  if (!raw) return false

  const record = parseViewerCapabilityRecord(raw)
  if (!record) return false

  if (!hashesEqual(record.tokenHash, hashViewerCapabilityToken(token))) {
    return false
  }

  const boundIp = record.boundIp.trim()
  const clientIp = input.clientIp.trim() || "unknown"
  if (boundIp !== clientIp) {
    return false
  }

  return true
}

/** Best-effort delete when the user's last socket leaves the room. */
export async function invalidateViewerCapabilityToken(input: {
  roomId: string
  userId: string
}): Promise<void> {
  try {
    const client = await getCommandClient()
    await client.del(keys.roomViewerCapability(input.roomId, input.userId))
  } catch (error) {
    console.warn("[viewer-capability] invalidate failed", error)
  }
}
