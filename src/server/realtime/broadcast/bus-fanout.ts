import {
  getSocketMeta,
  getSocketsForRoom,
  getSocketsForUser,
} from "@/server/ws/registry"
import type { WebSocket } from "ws"
import type {
  AdmissionChangedEnvelope,
  RoomBroadcastEnvelope,
} from "./channels"
import { BROADCAST_NODE_ID } from "./node-id"

export function sendRawToRoom(roomId: string, raw: string) {
  for (const client of getSocketsForRoom(roomId)) {
    if (client.readyState === client.OPEN) {
      client.send(raw)
    }
  }
}

export function sendToSocket(ws: WebSocket, envelope: RoomBroadcastEnvelope) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(envelope))
  }
}

/**
 * Notify then close every non-owner socket in this process's registry.
 * Owners stay connected. Copy the set first — close handlers mutate it.
 */
export function forceRejoinNonOwners(
  roomId: string,
  ownerId: string,
  envelope: AdmissionChangedEnvelope,
) {
  const raw = JSON.stringify(envelope)
  for (const client of [...getSocketsForRoom(roomId)]) {
    const meta = getSocketMeta(client)
    if (!meta || meta.userId === ownerId) continue
    if (client.readyState === client.OPEN) {
      try {
        client.send(raw)
      } catch {
        // Best-effort notify before close.
      }
    }
    try {
      client.close()
    } catch {
      // Already closing / closed.
    }
  }
}

/** Local delivery for user-targeted ephemerals (also used by Redis subscriber). */
export function fanOutUserEphemeral(
  roomId: string,
  targetUserId: string,
  envelope: { type: string; requestId?: string; payload: unknown },
) {
  const raw = JSON.stringify(envelope)
  for (const socket of getSocketsForUser(roomId, targetUserId)) {
    // Prefer OPEN (1); tolerate test fakes that omit the OPEN constant.
    const open = typeof socket.OPEN === "number" ? socket.OPEN : 1
    if (socket.readyState === open) {
      socket.send(raw)
    }
  }
}

type WiredEnvelope = RoomBroadcastEnvelope & { originNodeId?: string }

/** Fan-out from Redis subscriber (skip if we originated the message). */
export function fanOutFromPubSub(roomId: string, wired: WiredEnvelope) {
  if (wired.originNodeId && wired.originNodeId === BROADCAST_NODE_ID) {
    return
  }
  const { originNodeId: _origin, ...envelope } = wired
  if (envelope.type === "room:admission:changed") {
    forceRejoinNonOwners(
      roomId,
      envelope.payload.ownerId,
      envelope as AdmissionChangedEnvelope,
    )
    return
  }
  sendRawToRoom(roomId, JSON.stringify(envelope as RoomBroadcastEnvelope))
}
