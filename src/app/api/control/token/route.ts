import { mintControlToken } from "@/server/realtime/services/control-token"
import { matchIdentitySecret } from "@/server/realtime/services/identity-store"
import { getRoomStateStore } from "@/server/redis/state-store"
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/server/security/rate-limit"
import { NextResponse } from "next/server"
import { z } from "zod"

const mintSchema = z.object({
  roomId: z.string().min(1),
  userId: z.string().min(1),
  userSecret: z.string().min(1),
})

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request)
  const limit = consumeRateLimit({
    key: `control-token:${ip}`,
    limit: 20,
    windowMs: 60_000,
  })
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const parsed = mintSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
  }

  const { roomId, userId, userSecret } = parsed.data
  const identityOk = await matchIdentitySecret({ roomId, userId, userSecret })
  if (!identityOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const store = await getRoomStateStore()
  const state = await store.get(roomId)
  const participant = state?.participants[userId]
  const role = participant?.role
  if (role !== "owner" && role !== "moderator") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const minted = await mintControlToken({ roomId, userId })
  return NextResponse.json({
    token: minted.token,
    expiresAt: minted.expiresAt,
  })
}
