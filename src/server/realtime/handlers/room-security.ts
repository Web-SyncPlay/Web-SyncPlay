import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  roomDefaultRoleSetSchema,
  roomPasswordClearSchema,
  roomPasswordSetSchema,
} from "@/zod/schemas"
import type { RoomState } from "@/zod/types"
import type { z } from "zod"
import {
  clearJoinPassword,
  setDefaultJoinRole,
  setJoinPassword,
} from "../services/room-security"
import { mutateOwnerRoomMessage } from "./mutate-controlled"
import type { RoomMessageContext, RoomMessageHandler } from "./types"

type OwnerMutateBody = (
  state: RoomState,
  participant: RoomState["participants"][string],
) => boolean

async function withOwnerSecurityMutation<T extends z.ZodType>(
  ctx: RoomMessageContext,
  schema: T,
  payload: unknown,
  body: (parsed: z.infer<T>) => OwnerMutateBody,
): Promise<RoomState | null> {
  const result = schema.safeParse(payload)
  if (!result.success) return null
  return await mutateOwnerRoomMessage(ctx, body(result.data))
}

function logSecurityAction(
  state: RoomState,
  ctx: RoomMessageContext,
  participant: RoomState["participants"][string],
  action: "room:password:set" | "room:password:cleared" | "room:default-role:set",
  payload: Record<string, unknown>,
) {
  appendActionLog(state, {
    roomId: ctx.roomId,
    actorUserId: ctx.userId,
    actorUsername: participant.username,
    action,
    payload,
  })
}

/** Evict non-owners after admissionVersion bump (password set / clear / rotate). */
async function publishAdmissionEviction(
  roomId: string,
  state: RoomState,
): Promise<void> {
  await getRoomBroadcastBus().publishAdmissionChanged(roomId, {
    admissionVersion: state.roomSecurity.admissionVersion,
    ownerId: state.ownerId,
    joinPasswordEnabled: state.roomSecurity.joinPasswordEnabled,
  })
}

export const handleRoomPasswordSet: RoomMessageHandler = async (ctx, data) => {
  const next = await withOwnerSecurityMutation(
    ctx,
    roomPasswordSetSchema,
    data.payload,
    (parsed) => (state, participant) => {
      setJoinPassword(state, parsed.password)
      logSecurityAction(state, ctx, participant, "room:password:set", {
        joinPasswordEnabled: true,
      })
      return true
    },
  )
  if (next) {
    await publishAdmissionEviction(ctx.roomId, next)
  }
}

export const handleRoomPasswordClear: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const next = await withOwnerSecurityMutation(
    ctx,
    roomPasswordClearSchema,
    data.payload,
    () => (state, participant) => {
      if (!clearJoinPassword(state)) return false
      logSecurityAction(state, ctx, participant, "room:password:cleared", {
        joinPasswordEnabled: false,
      })
      return true
    },
  )
  if (next) {
    await publishAdmissionEviction(ctx.roomId, next)
  }
}

export const handleRoomDefaultRoleSet: RoomMessageHandler = async (
  ctx,
  data,
) => {
  await withOwnerSecurityMutation(
    ctx,
    roomDefaultRoleSetSchema,
    data.payload,
    (parsed) => (state, participant) => {
      if (!setDefaultJoinRole(state, parsed.role)) return false
      logSecurityAction(state, ctx, participant, "room:default-role:set", {
        defaultJoinRole: parsed.role,
      })
      return true
    },
  )
}
