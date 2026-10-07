import { createHash, randomBytes } from "node:crypto"
import { env } from "@/env"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { z } from "zod"

export type ControlTokenRecord = {
  roomId: string
  userId: string
  mintedAt: number
  expiresAt: number
}

const controlTokenRecordSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1),
  mintedAt: z.number().finite(),
  expiresAt: z.number().finite(),
})

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function parseControlTokenRecord(raw: string): ControlTokenRecord | null {
  try {
    const parsed = controlTokenRecordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
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
  const parsed = parseControlTokenRecord(raw)
  if (!parsed) return false
  if (parsed.roomId !== input.roomId || parsed.userId !== input.userId) {
    return false
  }
  if (parsed.expiresAt <= Date.now()) {
    return false
  }
  return true
}
