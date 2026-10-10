import type { roomErrorCodeSchema } from "@/contracts/schemas"
import type { WsEnvelope } from "@/contracts/types"
import type { z } from "zod"
import type { WebSocket } from "ws"

export type RoomErrorCode = z.infer<typeof roomErrorCodeSchema>

/**
 * C2S types that stay silent on failure (fire-and-forget / own reply channel).
 * Everything else in {@link ClientEventType} may receive `room:error` nacks.
 */
const NO_MUTATION_NACK = new Set<string>([
  "seek:preview",
  "participant:update",
  "local-media:webrtc:signal",
  "local-media:chunk",
  // SFU uses `local-media:sfu:result` for payload/auth failures; dispatch still
  // nacks rate_limited / not_joined via {@link shouldNackMutation}.
  "local-media:sfu:capabilities",
  "local-media:sfu:create-transport",
  "local-media:sfu:connect-transport",
  "local-media:sfu:produce-data",
  "local-media:sfu:consume-data",
])

/** Dispatch-level nacks (rate / join gate) — includes SFU RPCs. */
const DISPATCH_NACK_EXCLUDED = new Set<string>([
  "seek:preview",
  "participant:update",
  "local-media:webrtc:signal",
  "local-media:chunk",
])

export function shouldNackMutation(type: string): boolean {
  return !NO_MUTATION_NACK.has(type)
}

/** Rate-limit / not-joined nacks at the socket dispatch layer. */
export function shouldNackAtDispatch(type: string): boolean {
  return !DISPATCH_NACK_EXCLUDED.has(type)
}

export function sendMutationNack(
  ws: WebSocket,
  data: Pick<WsEnvelope<string, unknown>, "requestId" | "type">,
  code: RoomErrorCode,
  message?: string,
) {
  if (!data.requestId) return
  if (ws.readyState !== ws.OPEN) return
  try {
    ws.send(
      JSON.stringify({
        type: "room:error",
        requestId: data.requestId,
        payload: {
          code,
          type: data.type,
          ...(message ? { message } : {}),
        },
      }),
    )
  } catch (error) {
    console.error("[realtime] failed to send room:error", error)
  }
}
