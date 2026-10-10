import { DEFAULT_AVATAR_STYLE, resolveStyle } from "@/shared/avatar"
import { clearConnectionLocalPlaybackReport } from "@/server/realtime/services/local-playback-report-lifecycle"
import {
  getSocketMeta,
  setSocketPresenceTracked,
} from "@/server/ws/registry"
import { roomJoinSchema } from "@/contracts/schemas"
import type { SessionKind } from "@/contracts/types"
import { randomUUID } from "node:crypto"
import { admitJoin } from "./join/admit"
import { authorizeJoinSession } from "./join/authorize-session"
import { claimJoinIdentity } from "./join/claim-identity"
import { commitJoinMembership } from "./join/commit-membership"
import { postCommitJoinSideEffects } from "./join/post-commit"
import { resolveJoinParticipantProfile } from "./join/profile"
import { parseOrWarn } from "./parse-or-warn"
import type { JoinHandler } from "./types"

export { resolveJoinParticipantProfile }

/**
 * Join pipeline: admit → claimIdentity → authorizeSession → commitMembership →
 * postCommitSideEffects. Stages live under `./join/`.
 */
export const handleRoomJoin: JoinHandler = async (ctx, data) => {
  const join = parseOrWarn(roomJoinSchema, data.payload, data.type)
  if (!join) return

  const roomId = join.roomId
  const userId = String(join.userId || randomUUID())
  const username = String(join.username || "guest")
  const avatarStyle = resolveStyle(
    String(join.avatarStyle || DEFAULT_AVATAR_STYLE),
  )
  const userSecret = join.userSecret
  const joinPassword = join.joinPassword
  const sessionKind: SessionKind = join.sessionKind ?? "room"
  const controlToken = join.controlToken
  const initialMediaUrl = join.initialMediaUrl

  const previousMeta = getSocketMeta(ctx.ws)

  const existingState = await ctx.store.get(roomId)
  const admitted = await admitJoin({
    ws: ctx.ws,
    roomId,
    joinPassword,
    initialMediaUrl,
    existingState,
    requestId: data.requestId,
  })
  if (!admitted.ok) return

  if (
    previousMeta?.presenceTracked &&
    (previousMeta.roomId !== roomId || previousMeta.userId !== userId)
  ) {
    await ctx.store.removeWsConnectionRef(
      previousMeta.roomId,
      previousMeta.userId,
    )
    await clearConnectionLocalPlaybackReport(
      ctx.store,
      previousMeta.roomId,
      previousMeta.userId,
      previousMeta.connectionId,
    )
    setSocketPresenceTracked(ctx.ws, false)
  }

  const identityOk = await claimJoinIdentity({
    ws: ctx.ws,
    roomId,
    userId,
    userSecret,
    requestId: data.requestId,
  })
  if (!identityOk) return

  const { isControlSession, controlAuthorized } = await authorizeJoinSession({
    sessionKind,
    controlToken,
    roomId,
    userId,
  })

  // R2: delay room membership (addSocket) until after commit so room:control
  // cannot land on a half-joined socket. R3 gates non-join until joinCommitted.
  // Use pre-cleanup meta so same-socket rejoin keeps the existing presence ref.
  const isPresenceAlreadyTracked = Boolean(previousMeta?.presenceTracked)

  const {
    committed,
    reconnectingUserIds,
    disconnectingUserIds,
    sessionCapabilities,
  } = await commitJoinMembership({
    ws: ctx.ws,
    store: ctx.store,
    roomId,
    userId,
    username,
    avatarStyle,
    joinPassword,
    seedUrl: admitted.seedUrl,
    sessionKind,
    isControlSession,
    controlAuthorized,
    isPresenceAlreadyTracked,
    requestId: data.requestId,
  })

  if (!committed) return

  await postCommitJoinSideEffects({
    ws: ctx.ws,
    store: ctx.store,
    roomId,
    userId,
    controlAuthorized,
    isControlSession,
    sessionKind,
    isPresenceAlreadyTracked,
    committed,
    sessionCapabilities,
    reconnectingUserIds,
    disconnectingUserIds,
    requestId: data.requestId,
  })
}
