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
 * WATCH/GET/mutate/SET+PUBLISH for one user message: reconcile presence, run body, bump participant activity.
 * Body returns false to abort (no write).
 */
export async function mutateRoomMessage(
  store: RoomStateStorePort,
  roomId: string,
  userId: string,
  body: (
    state: RoomState,
    participant: RoomState["participants"][string],
  ) => boolean,
): Promise<void> {
  await store.updateRoom(roomId, async (state) => {
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
    return state
  })
}
