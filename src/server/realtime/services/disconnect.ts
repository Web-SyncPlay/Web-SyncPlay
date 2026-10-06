import { appendActionLog } from "@/server/log"
import {
  clearLocalMediaProviderReadyForOwner,
  deleteLocalMediaEntriesForOwner,
} from "@/server/media/local-media-store"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import type { RoomState } from "@/zod/types"
import { transferOwnershipIfNeeded } from "./ownership"
import {
  applyOfflinePruning,
  clearAllRoomPrunes,
  schedulePrune,
} from "./participants"
import { nextMonotonicMs } from "./timeline"

export type DisconnectSocketMeta = {
  roomId: string
  userId: string
  presenceTracked: boolean
}

async function deleteLocalMediaForRoomOwners(
  state: RoomState | null,
  roomId: string,
  extraOwnerUserIds: string[] = [],
): Promise<void> {
  const ownerIds = new Set<string>(extraOwnerUserIds)
  if (state) {
    for (const participant of Object.values(state.participants)) {
      ownerIds.add(participant.userId)
    }
    for (const item of state.playlist) {
      if (item.localOriginUserId) {
        ownerIds.add(item.localOriginUserId)
      }
    }
  }
  await Promise.all(
    [...ownerIds].map((ownerUserId) =>
      deleteLocalMediaEntriesForOwner(roomId, ownerUserId),
    ),
  )
}

/**
 * Tear down a room: Redis prune markers + local media + Redis state/presence/identities.
 * Prefer this over calling `store.delete` directly from lifecycle paths.
 */
export async function destroyRoom(
  store: RoomStateStorePort,
  roomId: string,
): Promise<void> {
  await clearAllRoomPrunes(roomId)
  try {
    const state = await store.get(roomId)
    await deleteLocalMediaForRoomOwners(state, roomId)
  } catch (error) {
    console.warn("[disconnect] local media cleanup before destroy failed", error)
  }
  await store.delete(roomId)
}

function invalidateLocalMediaForOwner(
  state: RoomState,
  userId: string,
  nowMs: number,
): boolean {
  let invalidatedCurrent = false
  let didMutate = false

  for (const item of state.playlist) {
    if (item.sourceKind !== "local_file") continue
    if (!item.localOriginUserId || item.localOriginUserId !== userId) continue
    if (item.blockedReason === "local_owner_offline") continue

    item.ingestStatus = "error"
    item.ingestError =
      "The person sharing this file went offline. Ask them to re-share it from the same tab."
    item.blockedReason = "local_owner_offline"
    didMutate = true

    if (state.playlist[state.currentIndex]?.id === item.id) {
      invalidatedCurrent = true
    }
  }

  if (invalidatedCurrent && !state.playback.paused) {
    state.playback.paused = true
    state.playback.serverNowMs = nextMonotonicMs(
      state.playback.serverNowMs,
      nowMs,
    )
    didMutate = true
  }

  return didMutate
}

/**
 * Apply participant-offline effects inside an existing room mutation.
 * Returns whether the room state was changed.
 */
export function applyUserWentOffline(
  state: RoomState,
  roomId: string,
  userId: string,
  nowMs = Date.now(),
): boolean {
  let didMutate = false
  const participant = state.participants[userId]
  if (participant) {
    participant.connected = false
    participant.disconnectedAt = nowMs
    participant.lastSeenAt = nowMs
    participant.localPlayback.updatedAt = nowMs
    didMutate = true
  }

  if (invalidateLocalMediaForOwner(state, userId, nowMs)) {
    didMutate = true
  }

  applyOfflinePruning(state)
  if (transferOwnershipIfNeeded(state, "disconnect")) {
    didMutate = true
  }

  if (participant) {
    appendActionLog(state, {
      roomId,
      actorUserId: userId,
      actorUsername: participant.username,
      action: "participant:disconnected",
      payload: {},
    })
  }

  if (didMutate) {
    state.updatedAt = nowMs
  }

  return didMutate
}

/**
 * Full socket-disconnect lifecycle: presence ref, room delete or offline effects.
 */
export async function handleSocketDisconnect(
  store: RoomStateStorePort,
  meta: DisconnectSocketMeta,
): Promise<void> {
  if (meta.presenceTracked) {
    await store.removeWsConnectionRef(meta.roomId, meta.userId)
  }

  const before = await store.get(meta.roomId)
  const pausedBefore = before?.playback.paused

  const next = await store.updateRoom(meta.roomId, async (state) => {
    if (!state) {
      return null
    }

    const activeUsers = await store.getWsPresenceUserIds(meta.roomId)
    if (activeUsers.size === 0) {
      await deleteLocalMediaForRoomOwners(state, meta.roomId, [meta.userId])
      await destroyRoom(store, meta.roomId)
      return null
    }

    // Any providing socket closed: File may be gone until a tab re-announces.
    await clearLocalMediaProviderReadyForOwner(meta.roomId, meta.userId)

    if (activeUsers.has(meta.userId)) {
      // Remaining tabs (any node) should re-declare which Files they still hold.
      const { publishLocalMediaReannounce } = await import(
        "@/server/media/local-media-reannounce"
      )
      await publishLocalMediaReannounce(meta.roomId, meta.userId)
      return null
    }

    applyUserWentOffline(state, meta.roomId, meta.userId)
    await deleteLocalMediaEntriesForOwner(meta.roomId, meta.userId)
    await schedulePrune(meta.roomId, meta.userId)
    state.generation = (state.generation ?? 0) + 1
    state.structuralRevision = (state.structuralRevision ?? 0) + 1
    return state
  })

  if (!next) {
    return
  }

  const bus = getRoomBroadcastBus()
  bus.attachStore(store)
  const now = Date.now()
  await store.mergePresenceData(meta.roomId, meta.userId, {
    connected: false,
    lastSeenAt: now,
    disconnectedAt: now,
    localPlayback: next.participants[meta.userId]?.localPlayback,
  })
  bus.markPresenceDirty(meta.roomId, meta.userId, {
    connected: false,
    lastSeenAt: now,
    disconnectedAt: now,
    localPlayback: next.participants[meta.userId]?.localPlayback,
  })

  const playbackChanged = pausedBefore !== next.playback.paused
  if (playbackChanged) {
    await bus.publishControl(meta.roomId, bus.controlPayloadFromState(next))
  }
  bus.markSnapshotDirty(meta.roomId)
}
