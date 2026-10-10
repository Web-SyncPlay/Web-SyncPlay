import { appendActionLog } from "@/server/log"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  roomDefaultRoleSetSchema,
  roomPasswordClearSchema,
  roomPasswordSetSchema,
} from "@/contracts/schemas"
import type { RoomState, WsEnvelope } from "@/contracts/types"
import type { z } from "zod"
import {
  clearJoinPassword,
  setDefaultJoinRole,
  setJoinPassword,
} from "../services/room-security"
import { mutateOwnerRoomMessage } from "./mutate-controlled"
import { parseOrNack } from "./parse-or-nack"
import type { RoomMessageContext, RoomMessageHandler } from "./types"

type OwnerMutateBody = (
  state: RoomState,
  participant: RoomState["participants"][string],
) => boolean | Promise<boolean>

async function withOwnerSecurityMutation<T extends z.ZodType>(
  ctx: RoomMessageContext,
  data: WsEnvelope<string, Record<string, unknown>>,
  schema: T,
  body: (parsed: z.infer<T>) => OwnerMutateBody,
): Promise<RoomState | null> {
  const parsed = parseOrNack(schema, ctx.ws, data)
  if (!parsed) return null
  return await mutateOwnerRoomMessage(ctx, data, body(parsed))
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
    data,
    roomPasswordSetSchema,
    (parsed) => async (state, participant) => {
      await setJoinPassword(state, parsed.password)
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
    data,
    roomPasswordClearSchema,
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
    data,
    roomDefaultRoleSetSchema,
    (parsed) => (state, participant) => {
      if (!setDefaultJoinRole(state, parsed.role)) return false
      logSecurityAction(state, ctx, participant, "room:default-role:set", {
        defaultJoinRole: parsed.role,
      })
      return true
    },
  )
}
