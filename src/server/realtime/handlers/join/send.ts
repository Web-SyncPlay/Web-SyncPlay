import type { WsEnvelope } from "@/contracts/types"
import type { WebSocket } from "ws"

export function sendEnvelope<TPayload>(
  ws: WebSocket,
  envelope: WsEnvelope<string, TPayload>,
) {
  try {
    ws.send(JSON.stringify(envelope))
  } catch (error) {
    console.error(`[realtime] failed to send ${envelope.type}`, error)
  }
}
