import type { RoomPublishHint } from "@/server/realtime/broadcast/channels"
import {
  canControlFromConnectionContext,
  canManageRoomSecurityFromConnectionContext,
  type ConnectionAuthContext,
} from "@/server/realtime/services/permissions"
import type { RoomState } from "@/zod/types"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageContext } from "./types"

type MutateBody = (
  state: RoomState,
  participant: RoomState["participants"][string],
) => boolean

export function connectionAuthFromContext(
  ctx: RoomMessageContext,
): ConnectionAuthContext {
  return {
    controlAuthorized: ctx.controlAuthorized,
    isControlSession: ctx.isControlSession,
    sessionKind: ctx.sessionKind,
  }
}

/**
 * mutateRoomMessage with the standard playback/playlist control gate.
 * Body runs only when the connection may control the room.
 */
export async function mutateControlledRoomMessage(
  ctx: RoomMessageContext,
  body: MutateBody,
  hint: RoomPublishHint = { kind: "control" },
): Promise<RoomState | null> {
  const auth = connectionAuthFromContext(ctx)
  return await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (!canControlFromConnectionContext(state, ctx.userId, auth)) {
        return false
      }
      return body(state, participant)
    },
    hint,
  )
}

/**
 * mutateRoomMessage gated to owner + session (room password / default join role).
 */
export async function mutateOwnerRoomMessage(
  ctx: RoomMessageContext,
  body: MutateBody,
  hint: RoomPublishHint = { kind: "snapshot" },
): Promise<RoomState | null> {
  const auth = connectionAuthFromContext(ctx)
  return await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canManageRoomSecurityFromConnectionContext(state, ctx.userId, auth)
      ) {
        return false
      }
      return body(state, participant)
    },
    hint,
  )
}
