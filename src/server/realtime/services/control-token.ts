import { createHash, randomBytes } from "node:crypto"
import { env } from "@/env"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"

export type ControlTokenRecord = {
  roomId: string
  userId: string
  mintedAt: number
  expiresAt: number
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function mintControlToken(input: {
  roomId: string
  userId: string
}): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("base64url")
  const tokenHash = hashToken(token)
  const mintedAt = Date.now()
  const expiresAt = mintedAt + env.CONTROL_TOKEN_TTL_SECONDS * 1000
  const record: ControlTokenRecord = {
    roomId: input.roomId,
    userId: input.userId,
    mintedAt,
    expiresAt,
  }
  const client = await getCommandClient()
  await client.set(keys.controlToken(tokenHash), JSON.stringify(record), {
    EX: env.CONTROL_TOKEN_TTL_SECONDS,
  })
  return { token, expiresAt }
}

export async function validateControlToken(input: {
  token: string
  roomId: string
  userId: string
}): Promise<boolean> {
  const client = await getCommandClient()
  const raw = await client.get(keys.controlToken(hashToken(input.token)))
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as ControlTokenRecord
    if (parsed.roomId !== input.roomId || parsed.userId !== input.userId) {
      return false
    }
    if (parsed.expiresAt <= Date.now()) {
      return false
    }
    return true
  } catch {
    return false
  }
}
