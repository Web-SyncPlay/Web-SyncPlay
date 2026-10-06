import { appendActionLog } from "@/server/log"
import { canManageRoomSecurityFromConnectionContext } from "@/server/realtime/services/permissions"
import { roomPasswordClearSchema, roomPasswordSetSchema } from "@/zod/schemas"
import { clearJoinPassword, setJoinPassword } from "../services/room-security"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageHandler } from "./types"

export const handleRoomPasswordSet: RoomMessageHandler = async (ctx, data) => {
  const result = roomPasswordSetSchema.safeParse(data.payload)
  if (!result.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canManageRoomSecurityFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }

      setJoinPassword(state, result.data.password)
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "room:password:set",
        payload: {
          joinPasswordEnabled: true,
        },
      })
      return true
    },
    { kind: "snapshot" },
  )
}

export const handleRoomPasswordClear: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const result = roomPasswordClearSchema.safeParse(data.payload)
  if (!result.success) {
    return
  }

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state, participant) => {
      if (
        !canManageRoomSecurityFromConnectionContext(state, ctx.userId, {
          controlAuthorized: ctx.controlAuthorized,
          isControlSession: ctx.isControlSession,
          sessionKind: ctx.sessionKind,
        })
      ) {
        return false
      }

      if (!clearJoinPassword(state)) {
        return false
      }

      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "room:password:cleared",
        payload: {
          joinPasswordEnabled: false,
        },
      })
      return true
    },
    { kind: "snapshot" },
  )
}
