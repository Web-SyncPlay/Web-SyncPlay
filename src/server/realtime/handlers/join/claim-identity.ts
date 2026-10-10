import { claimOrVerifyIdentitySecret } from "@/server/realtime/services/identity-store"
import type { WebSocket } from "ws"
import { sendEnvelope } from "./send"

export async function claimJoinIdentity(options: {
  ws: WebSocket
  roomId: string
  userId: string
  userSecret: string
  requestId?: string
}): Promise<boolean> {
  const identityOk = await claimOrVerifyIdentitySecret({
    roomId: options.roomId,
    userId: options.userId,
    userSecret: options.userSecret,
  })
  if (!identityOk) {
    sendEnvelope(options.ws, {
      type: "room:join:rejected",
      requestId: options.requestId,
      payload: { reason: "identity_mismatch" },
    })
    return false
  }
  return true
}
