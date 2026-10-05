import { appendActionLog } from "@/server/log"
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
        state.ownerId !== ctx.userId ||
        ctx.sessionKind === "player" ||
        (ctx.isControlSession && !ctx.controlAuthorized)
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
        state.ownerId !== ctx.userId ||
        ctx.sessionKind === "player" ||
        (ctx.isControlSession && !ctx.controlAuthorized)
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
  )
}
