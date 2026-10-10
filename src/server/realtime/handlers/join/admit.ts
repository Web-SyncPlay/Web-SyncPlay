import { evaluateCreateMediaSeed } from "@/server/realtime/services/room"
import { getSocketClientIp } from "@/server/ws/registry"
import { consumeRateLimit } from "@/server/security/rate-limit"
import type { RoomJoinRejectedReason, RoomState } from "@/contracts/types"
import type { WebSocket } from "ws"
import { evaluateJoinAdmission } from "../../services/room-security"
import { sendEnvelope } from "./send"

export type AdmitJoinInput = {
  ws: WebSocket
  roomId: string
  joinPassword: string | undefined
  initialMediaUrl: string | undefined
  existingState: RoomState | null
  requestId?: string
}

export type AdmitJoinResult =
  | {
      ok: true
      seedUrl: string | undefined
    }
  | { ok: false }

/**
 * Pre-commit admission: join rate limits, create-media seed, password gate.
 */
export async function admitJoin(
  input: AdmitJoinInput,
): Promise<AdmitJoinResult> {
  const joinRoomLimit = await consumeRateLimit({
    key: `join:room:${input.roomId}`,
    limit: 60,
    windowMs: 60_000,
  })
  if (!joinRoomLimit.allowed) {
    reject(input.ws, input.requestId, "rate_limited")
    return { ok: false }
  }

  const clientIp = getSocketClientIp(input.ws)
  const joinIpLimit = await consumeRateLimit({
    key: `join:ip:${clientIp}:room:${input.roomId}`,
    limit: 12,
    windowMs: 60_000,
  })
  if (!joinIpLimit.allowed) {
    reject(input.ws, input.requestId, "rate_limited")
    return { ok: false }
  }

  const mediaSeed = evaluateCreateMediaSeed({
    roomExists: Boolean(input.existingState),
    initialMediaUrl: input.initialMediaUrl,
  })
  if (!mediaSeed.ok) {
    reject(input.ws, input.requestId, mediaSeed.reason)
    return { ok: false }
  }

  const admission = await evaluateJoinAdmission(
    input.existingState,
    input.joinPassword,
  )
  if (!admission.allowed) {
    reject(input.ws, input.requestId, admission.reason)
    return { ok: false }
  }

  return { ok: true, seedUrl: mediaSeed.seedUrl }
}

function reject(
  ws: WebSocket,
  requestId: string | undefined,
  reason: RoomJoinRejectedReason,
) {
  sendEnvelope(ws, {
    type: "room:join:rejected",
    requestId,
    payload: { reason },
  })
}
