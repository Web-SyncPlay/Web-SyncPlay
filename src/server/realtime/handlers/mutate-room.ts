import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomPublishHint } from "@/server/realtime/broadcast/channels"
import {
  clearPrune,
  reconcileParticipantsConnectivity,
  schedulePrune,
} from "@/server/realtime/services/participants"
import { applyRoomStateRepair } from "@/server/realtime/services/room-state-repair"
import { markCurrentMedia } from "@/server/realtime/services/timeline"
import type { RoomStateStorePort } from "@/server/ports"
import type { RoomState } from "@/contracts/types"

function bumpsStructuralRevision(hint: RoomPublishHint): boolean {
  return (
    hint.kind === "snapshot" ||
    hint.kind === "control+snapshot" ||
    hint.kind === "action-log"
  )
}

/**
 * In-memory presence reconcile only. Prune Redis side effects must wait until
 * after a successful room write (see mutateRoomMessage post-commit path).
 */
async function reconcilePresenceForMutation(
  store: RoomStateStorePort,
  state: RoomState,
  roomId: string,
): Promise<{ disconnecting: string[]; reconnecting: string[] }> {
  const active = await store.getWsPresenceUserIds(roomId)
  return reconcileParticipantsConnectivity(state, active)
}

async function publishAfterMutation(
  roomId: string,
  userId: string,
  next: RoomState,
  hint: RoomPublishHint,
) {
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
}

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
  ) => boolean | Promise<boolean>,
  hint: RoomPublishHint = { kind: "snapshot" },
): Promise<RoomState | null> {
  let disconnectingUserIds: string[] = []
  let reconnectingUserIds: string[] = []

  const next = await store.updateRoom(roomId, async (state) => {
    if (!state) return null
    const recon = await reconcilePresenceForMutation(store, state, roomId)
    disconnectingUserIds = recon.disconnecting
    reconnectingUserIds = recon.reconnecting

    const participant = state.participants[userId]
    if (!participant) {
      return null
    }

    if (!(await body(state, participant))) {
      return null
    }

    applyRoomStateRepair(state)

    participant.connected = true
    participant.lastSeenAt = Date.now()
    participant.disconnectedAt = undefined
    markCurrentMedia(state)
    state.updatedAt = Date.now()
    state.generation = (state.generation ?? 0) + 1

    if (bumpsStructuralRevision(hint)) {
      state.structuralRevision = (state.structuralRevision ?? 0) + 1
    }

    return state
  })

  if (!next) {
    return null
  }

  // H3: only hit Redis prune keys after a successful room write commit.
  for (const uid of reconnectingUserIds) {
    await clearPrune(roomId, uid)
  }
  for (const uid of disconnectingUserIds) {
    await schedulePrune(roomId, uid)
  }

  await publishAfterMutation(roomId, userId, next, hint)
  return next
}
