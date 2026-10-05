import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import type { RoomState } from "@/zod/types"
import { mutateRoomMessage } from "./mutate-room"
import type { RoomMessageContext } from "./types"

/**
 * mutateRoomMessage with the standard playback/playlist control gate.
 * Body runs only when the connection may control the room.
 */
export async function mutateControlledRoomMessage(
  ctx: RoomMessageContext,
  body: (
    state: RoomState,
    participant: RoomState["participants"][string],
  ) => boolean,
): Promise<void> {
  await mutateRoomMessage(ctx.store, ctx.roomId, ctx.userId, (state, participant) => {
    if (
      !canControlFromConnectionContext(state, ctx.userId, {
        controlAuthorized: ctx.controlAuthorized,
        isControlSession: ctx.isControlSession,
        sessionKind: ctx.sessionKind,
      })
    ) {
      return false
    }
    return body(state, participant)
  })
}
