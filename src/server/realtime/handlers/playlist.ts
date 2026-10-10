import { env } from "@/env"
import { isProgressiveMediaMime } from "@/shared/media-mime"
import { appendActionLog } from "@/server/log"
import { createLocalMediaEntry } from "@/server/media/local-media-store"
import {
  resolvePlaylistItem,
  reresolveRemotePlaylistItem,
} from "@/server/realtime/services/playlist-resolve"
import {
  applyPlaylistItemDuration,
  applyPlaylistItemError,
  applyPlaylistRemove,
  applyPlaylistRename,
  applyPlaylistReorder,
  applyPlaylistSelect,
  buildLocalFilePlaylistItem,
  buildRemoteUrlPlaylistItem,
  canRetryRemotePlaylistItem,
  isPlaylistAtLimit,
} from "@/server/realtime/services/playlist-ops"
import { canControlFromConnectionContext } from "@/server/realtime/services/permissions"
import { consumeRateLimit } from "@/server/security/rate-limit"
import {
  playlistAddLocalSchema,
  playlistAddUrlSchema,
  playlistItemDurationSchema,
  playlistItemErrorSchema,
  playlistRemoveSchema,
  playlistRenameSchema,
  playlistReorderSchema,
  playlistRetrySchema,
  playlistSelectSchema,
} from "@/contracts/schemas"
import { randomUUID } from "node:crypto"
import {
  connectionAuthFromContext,
  mutateControlledRoomMessage,
} from "./mutate-controlled"
import { mutateRoomMessage } from "./mutate-room"
import { parseOrNack } from "./parse-or-nack"
import { sendMutationNack } from "./mutation-nack"
import type { RoomMessageContext, RoomMessageHandler } from "./types"

const RESOLVE_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const

async function consumePlaylistResolveLimit(
  ctx: RoomMessageContext,
): Promise<boolean> {
  const result = await consumeRateLimit({
    key: `resolve:${ctx.roomId}:${ctx.userId}`,
    ...RESOLVE_RATE_LIMIT,
  })
  return result.allowed
}

export const handlePlaylistSelect: RoomMessageHandler = async (ctx, data) => {
  const select = parseOrNack(playlistSelectSchema, ctx.ws, data)
  if (!select) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const nextIndex = select.index
      if (!applyPlaylistSelect(state, nextIndex)) return false
      // Keep play/pause intent across item changes. Forcing pause here used to
      // rely on a client-only autoPlayAfterLoad flag that was cleared when the
      // new src mounted — leaving YouTube (and others) permanently stuck paused.
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "media:played",
        payload: {
          index: nextIndex,
          mediaName: state.playlist[nextIndex]?.name,
          mediaId: state.playlist[nextIndex]?.id,
        },
      })
      return true
    },
    { kind: "control" },
  )
}

export const handlePlaylistAddUrl: RoomMessageHandler = async (ctx, data) => {
  const addUrl = parseOrNack(playlistAddUrlSchema, ctx.ws, data)
  if (!addUrl) return

  if (!(await consumePlaylistResolveLimit(ctx))) {
    sendMutationNack(ctx.ws, data, "rate_limited")
    return
  }

  const queuedItemId = randomUUID()
  const sourceUrl = addUrl.url
  let shouldResolve = false

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      if (isPlaylistAtLimit(state, env.ROOM_PLAYLIST_LIMIT)) return false
      shouldResolve = true
      state.playlist.push(
        buildRemoteUrlPlaylistItem({
          id: queuedItemId,
          sourceUrl,
          createdBy: ctx.userId,
        }),
      )
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:add",
        payload: {
          itemId: queuedItemId,
          itemName: sourceUrl,
          index: state.playlist.length - 1,
          pending: true,
        },
      })
      return true
    },
    { kind: "snapshot" },
  )

  if (!shouldResolve) return

  await resolvePlaylistItem({
    store: ctx.store,
    roomId: ctx.roomId,
    itemId: queuedItemId,
    sourceUrl,
  })
}

export const handlePlaylistAddLocal: RoomMessageHandler = async (ctx, data) => {
  const parsed = parseOrNack(playlistAddLocalSchema, ctx.ws, data)
  if (!parsed) return

  if (!isProgressiveMediaMime(parsed.mimeType)) return

  try {
    await createLocalMediaEntry({
      id: parsed.localMediaId,
      roomId: ctx.roomId,
      ownerUserId: ctx.userId,
      filename: parsed.name,
      mimeType: parsed.mimeType,
      sizeBytes: parsed.sizeBytes,
      // Client registers the File before sending playlist:add:local.
      providerReady: true,
    })
  } catch (error) {
    console.error("[playlist] failed to register local media metadata", error)
    return
  }

  const itemId = randomUUID()
  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      if (isPlaylistAtLimit(state, env.ROOM_PLAYLIST_LIMIT)) return false
      state.playlist.push(
        buildLocalFilePlaylistItem({
          id: itemId,
          name: parsed.name,
          localMediaId: parsed.localMediaId,
          mimeType: parsed.mimeType,
          sizeBytes: parsed.sizeBytes,
          createdBy: ctx.userId,
          durationSeconds: parsed.durationSeconds,
        }),
      )
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:add",
        payload: {
          itemId,
          itemName: parsed.name,
          index: state.playlist.length - 1,
          sourceKind: "local_file",
        },
      })
      return true
    },
    { kind: "snapshot" },
  )
}

export const handlePlaylistRetry: RoomMessageHandler = async (ctx, data) => {
  const parsed = parseOrNack(playlistRetrySchema, ctx.ws, data)
  if (!parsed) return

  if (!(await consumePlaylistResolveLimit(ctx))) {
    sendMutationNack(ctx.ws, data, "rate_limited")
    return
  }

  const state = await ctx.store.get(ctx.roomId)
  if (!state) return
  if (
    !canControlFromConnectionContext(
      state,
      ctx.userId,
      connectionAuthFromContext(ctx),
    )
  ) {
    sendMutationNack(ctx.ws, data, "unauthorized")
    return
  }

  const item = state.playlist.find((entry) => entry.id === parsed.itemId)
  if (!canRetryRemotePlaylistItem(item)) return

  await reresolveRemotePlaylistItem({
    store: ctx.store,
    roomId: ctx.roomId,
    itemId: parsed.itemId,
  })
}

export const handlePlaylistItemError: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrNack(playlistItemErrorSchema, ctx.ws, data)
  if (!parsed) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const result = applyPlaylistItemError(
        state,
        parsed.itemId,
        parsed.error,
      )
      if (!result) return false
      if (result.cleared) return true

      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "participant:error",
        payload: {
          itemId: result.item.id,
          mediaName: result.item.name,
        },
        error: parsed.error ?? undefined,
      })
      return true
    },
    { kind: "control+snapshot" },
  )
}

/**
 * Any connected player may fill missing catalog duration once observed.
 * Does not require control authority — guests load media too.
 */
export const handlePlaylistItemDuration: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrNack(playlistItemDurationSchema, ctx.ws, data)
  if (!parsed) return

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state) => {
      const item = applyPlaylistItemDuration(
        state,
        parsed.itemId,
        parsed.durationSeconds,
      )
      return Boolean(item)
    },
    { kind: "snapshot" },
  )
}

export const handlePlaylistReorder: RoomMessageHandler = async (ctx, data) => {
  const reorder = parseOrNack(playlistReorderSchema, ctx.ws, data)
  if (!reorder) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const { from, to } = reorder
      const entry = applyPlaylistReorder(state, from, to)
      if (!entry) return false
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:reorder",
        payload: {
          itemId: entry.id,
          itemName: entry.name,
          from,
          to,
        },
      })
      return true
    },
    { kind: "snapshot" },
  )
}

export const handlePlaylistRename: RoomMessageHandler = async (ctx, data) => {
  const rename = parseOrNack(playlistRenameSchema, ctx.ws, data)
  if (!rename) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const result = applyPlaylistRename(state, rename.itemId, rename.name)
      if (!result) return false
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:rename",
        payload: {
          itemId: result.item.id,
          previousName: result.previousName,
          nextName: result.nextName,
        },
      })
      return true
    },
    { kind: "snapshot" },
  )
}

export const handlePlaylistRemove: RoomMessageHandler = async (ctx, data) => {
  const remove = parseOrNack(playlistRemoveSchema, ctx.ws, data)
  if (!remove) return

  await mutateControlledRoomMessage(
    ctx,
    data,
    (state, participant) => {
      const result = applyPlaylistRemove(state, remove.itemId)
      if (!result) return false
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:remove",
        payload: {
          itemId: result.removed.id,
          itemName: result.removed.name,
          index: result.index,
        },
      })
      return true
    },
    { kind: "snapshot" },
  )
}
