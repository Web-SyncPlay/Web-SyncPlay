import type { LocalMediaReadRequest } from "@/server/media/local-media-relay/types"
import type { WebSocket } from "ws"

export function sendReadToSockets(
  sockets: Iterable<WebSocket>,
  request: LocalMediaReadRequest,
) {
  const raw = JSON.stringify({
    type: "local-media:read",
    payload: request,
  })
  let sent = 0
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(raw)
      sent += 1
    }
  }
  return sent
}
