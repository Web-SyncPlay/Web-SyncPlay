import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  clearPrune,
  schedulePrune,
} from "@/server/realtime/services/participants"
import { scheduleResolvingPlaylistItems } from "@/server/realtime/services/room"
import type { SessionCapabilities } from "@/server/realtime/services/permissions"
import type { RoomStateStorePort } from "@/server/ports"
import {
  addSocket,
  getSocketClientIp,
  getSocketMeta,
  setSocketCanControlPlayback,
  setSocketControlAuthorized,
  setSocketJoinCommitted,
  setSocketPresenceTracked,
} from "@/server/ws/registry"
import type { RoomState, SessionKind } from "@/contracts/types"
import { WebSocket } from "ws"
import { abortJoinAfterCommit } from "./abort"
import {
  canSetJoinCommitted,
  shouldAddPresenceOnJoin,
} from "./membership-timing"
import { sendEnvelope } from "./send"

export type PostCommitInput = {
  ws: WebSocket
  store: RoomStateStorePort
  roomId: string
  userId: string
  controlAuthorized: boolean
  isControlSession: boolean
  sessionKind: SessionKind
  isPresenceAlreadyTracked: boolean
  committed: RoomState
  sessionCapabilities: SessionCapabilities | undefined
  reconnectingUserIds: string[]
  disconnectingUserIds: string[]
  requestId?: string
}

/**
 * After a successful room write: registry membership, presence, snapshot, caps.
 */
export async function postCommitJoinSideEffects(
  input: PostCommitInput,
): Promise<void> {
  let didAddPresence = false

  // R1: socket must still be open before membership / presence.
  if (input.ws.readyState !== WebSocket.OPEN) {
    await abortJoinAfterCommit({
      ws: input.ws,
      store: input.store,
      roomId: input.roomId,
      userId: input.userId,
      requestId: input.requestId,
      didAddPresence: false,
    })
    return
  }

  addSocket(input.ws, {
    roomId: input.roomId,
    userId: input.userId,
    controlAuthorized: input.controlAuthorized,
    isControlSession: input.isControlSession,
    sessionKind: input.sessionKind,
    joinCommitted: false,
  })
  setSocketControlAuthorized(input.ws, input.controlAuthorized)

  if (!getSocketMeta(input.ws)) {
    await abortJoinAfterCommit({
      ws: input.ws,
      store: input.store,
      roomId: input.roomId,
      userId: input.userId,
      requestId: input.requestId,
      didAddPresence: false,
    })
    return
  }

  if (shouldAddPresenceOnJoin(input.isPresenceAlreadyTracked)) {
    await input.store.addWsConnectionRef(input.roomId, input.userId)
    setSocketPresenceTracked(input.ws, true)
    didAddPresence = true
  }

  // R1 again after presence: close may have raced addWsConnectionRef (D3).
  // R3: only then may joinCommitted flip true.
  if (
    !canSetJoinCommitted({
      readyState: input.ws.readyState,
      openState: WebSocket.OPEN,
      hasSocketMeta: Boolean(getSocketMeta(input.ws)),
    })
  ) {
    await abortJoinAfterCommit({
      ws: input.ws,
      store: input.store,
      roomId: input.roomId,
      userId: input.userId,
      requestId: input.requestId,
      didAddPresence,
    })
    return
  }

  setSocketJoinCommitted(input.ws, true)
  setSocketCanControlPlayback(
    input.ws,
    input.sessionCapabilities?.canControlPlayback ?? false,
  )

  // Force lifecycle TTL refresh on join (bypasses post-message throttle).
  await input.store.touchWsPresence(input.roomId, input.userId, { force: true })
  // Joiner prune clear moved out of WATCH (was inside commitJoinMembership).
  await clearPrune(input.roomId, input.userId)

  scheduleResolvingPlaylistItems(
    input.store,
    input.roomId,
    input.committed.playlist,
  )

  const bus = getRoomBroadcastBus()
  bus.attachStore(input.store)
  await input.store.mergePresenceData(input.roomId, input.userId, {
    connected: true,
    lastSeenAt: Date.now(),
    localPlayback: input.committed.participants[input.userId]?.localPlayback,
    username: input.committed.participants[input.userId]?.username,
    avatarStyle: input.committed.participants[input.userId]?.avatarStyle,
  })

  // Critical: joiner must receive state without relying on store publish.
  const snapshot = await bus.buildSanitizedSnapshot(input.roomId)
  if (snapshot) {
    bus.sendToSocket(input.ws, { type: "room:snapshot", payload: snapshot })
  }
  bus.markSnapshotDirty(input.roomId)
  bus.markPresenceDirty(input.roomId, input.userId, {
    connected: true,
    lastSeenAt: Date.now(),
    localPlayback: input.committed.participants[input.userId]?.localPlayback,
  })

  if (input.sessionCapabilities) {
    let viewerToken: string | undefined
    try {
      const { mintViewerCapabilityToken } = await import(
        "@/server/media/viewer-capability-token"
      )
      const minted = await mintViewerCapabilityToken({
        roomId: input.roomId,
        userId: input.userId,
        boundIp: getSocketClientIp(input.ws),
      })
      viewerToken = minted.token
    } catch (error) {
      console.warn("[realtime] viewer capability mint failed", error)
    }
    sendEnvelope(input.ws, {
      type: "session:capabilities",
      payload: {
        ...input.sessionCapabilities,
        ...(viewerToken ? { viewerToken } : {}),
      },
    })
  }

  for (const uid of input.reconnectingUserIds) {
    await clearPrune(input.roomId, uid)
  }
  for (const uid of input.disconnectingUserIds) {
    await schedulePrune(input.roomId, uid)
  }
}
