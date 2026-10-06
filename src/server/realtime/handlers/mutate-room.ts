import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomPublishHint } from "@/server/realtime/broadcast/channels"
import {
  applyOfflinePruning,
  clearPrune,
  reconcileParticipantsConnectivity,
  schedulePrune,
} from "@/server/realtime/services/participants"
import { markCurrentMedia } from "@/server/realtime/services/timeline"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import type { RoomState } from "@/zod/types"

/**
 * WATCH/GET/mutate/SET for one user message: reconcile presence, run body, bump activity.
 * Body returns false to abort (no write). Publish via RoomBroadcastBus per hint.
 */
export async function mutateRoomMessage(
  store: RoomStateStorePort,
  roomId: string,
  userId: string,
  body: (
    state: RoomState,
    participant: RoomState["participants"][string],
  ) => boolean,
  hint: RoomPublishHint = { kind: "snapshot" },
): Promise<RoomState | null> {
  const next = await store.updateRoom(roomId, async (state) => {
    if (!state) return null
    const active = await store.getWsPresenceUserIds(roomId)
    const recon = reconcileParticipantsConnectivity(state, active)
    for (const uid of recon.disconnecting) {
      schedulePrune(roomId, uid, store)
    }
    for (const uid of recon.reconnecting) {
      clearPrune(roomId, uid)
    }
    applyOfflinePruning(state)

    const participant = state.participants[userId]
    if (!participant) {
      return null
    }

    if (!body(state, participant)) {
      return null
    }

    participant.connected = true
    participant.lastSeenAt = Date.now()
    participant.disconnectedAt = undefined
    markCurrentMedia(state)
    state.updatedAt = Date.now()
    state.generation = (state.generation ?? 0) + 1

    if (
      hint.kind === "snapshot" ||
      hint.kind === "control+snapshot" ||
      hint.kind === "action-log"
    ) {
      state.structuralRevision = (state.structuralRevision ?? 0) + 1
    }

    return state
  })

  if (!next) {
    return null
  }

  const bus = getRoomBroadcastBus()
  switch (hint.kind) {
    case "control":
      await bus.publishControl(roomId, bus.controlPayloadFromState(next))
      // Action log entries from control appear on a ≤2s coalesced snapshot.
      bus.markActionLogDirty(roomId)
      break
    case "control+snapshot":
      await bus.publishControl(roomId, bus.controlPayloadFromState(next))
      bus.markSnapshotDirty(roomId)
      break
    case "snapshot":
      bus.markSnapshotDirty(roomId)
      break
    case "action-log":
      bus.markActionLogDirty(roomId)
      break
    case "presence":
      bus.markPresenceDirty(roomId, userId, {
        connected: true,
        lastSeenAt: next.participants[userId]?.lastSeenAt,
        localPlayback: next.participants[userId]?.localPlayback,
      })
      break
    case "control-ephemeral":
      break
  }

  return next
}
