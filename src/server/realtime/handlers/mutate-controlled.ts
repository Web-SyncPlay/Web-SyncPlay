import type { RoomPublishHint } from "@/server/realtime/broadcast/channels"
import {
  canControlFromConnectionContext,
  canManageRoomSecurityFromConnectionContext,
  type ConnectionAuthContext,
} from "@/server/realtime/services/permissions"
import type { RoomState, WsEnvelope } from "@/contracts/types"
import { sendMutationNack } from "./mutation-nack"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageContext } from "./types"

type MutateBody = (
  state: RoomState,
  participant: RoomState["participants"][string],
) => boolean | Promise<boolean>

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
 * Auth denials emit `room:error` / `unauthorized` when `requestId` is set.
 */
export async function mutateControlledRoomMessage(
  ctx: RoomMessageContext,
  data: WsEnvelope<string, Record<string, unknown>>,
  body: MutateBody,
  hint: RoomPublishHint = { kind: "control" },
): Promise<RoomState | null> {
  const auth = connectionAuthFromContext(ctx)
  let denied = false
  const result = await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (!canControlFromConnectionContext(state, ctx.userId, auth)) {
        denied = true
        return false
      }
      return body(state, participant)
    },
    hint,
  )
  if (denied) {
    sendMutationNack(ctx.ws, data, "unauthorized")
  }
  return result
}

/**
 * mutateRoomMessage gated to owner + session (room password / default join role).
 */
export async function mutateOwnerRoomMessage(
  ctx: RoomMessageContext,
  data: WsEnvelope<string, Record<string, unknown>>,
  body: MutateBody,
  hint: RoomPublishHint = { kind: "snapshot" },
): Promise<RoomState | null> {
  const auth = connectionAuthFromContext(ctx)
  let denied = false
  const result = await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canManageRoomSecurityFromConnectionContext(state, ctx.userId, auth)
      ) {
        denied = true
        return false
      }
      return body(state, participant)
    },
    hint,
  )
  if (denied) {
    sendMutationNack(ctx.ws, data, "unauthorized")
  }
  return result
}
