import { env } from "@/env"
import { isProgressiveMediaMime } from "@/lib/media-mime"
import { appendActionLog } from "@/server/log"
import { createLocalMediaEntry } from "@/server/media/local-media-store"
import {
  resolvePlaylistItem,
  reresolveRemotePlaylistItem,
} from "@/server/realtime/services/playlist-resolve"
import {
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
  playlistItemErrorSchema,
  playlistRemoveSchema,
  playlistRenameSchema,
  playlistReorderSchema,
  playlistRetrySchema,
  playlistSelectSchema,
} from "@/zod/schemas"
import { randomUUID } from "node:crypto"
import {
  connectionAuthFromContext,
  mutateControlledRoomMessage,
} from "./mutate-controlled"
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
  const selectResult = playlistSelectSchema.safeParse(data.payload)
  if (!selectResult.success) return

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const nextIndex = selectResult.data.index
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
  const addUrlResult = playlistAddUrlSchema.safeParse(data.payload)
  if (!addUrlResult.success) return

  if (!(await consumePlaylistResolveLimit(ctx))) return

  const queuedItemId = randomUUID()
  const sourceUrl = addUrlResult.data.url
  let shouldResolve = false

  await mutateControlledRoomMessage(
    ctx,
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
  const parsed = playlistAddLocalSchema.safeParse(data.payload)
  if (!parsed.success) return

  if (!isProgressiveMediaMime(parsed.data.mimeType)) return

  try {
    await createLocalMediaEntry({
      id: parsed.data.localMediaId,
      roomId: ctx.roomId,
      ownerUserId: ctx.userId,
      filename: parsed.data.name,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
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
    (state, participant) => {
      if (isPlaylistAtLimit(state, env.ROOM_PLAYLIST_LIMIT)) return false
      state.playlist.push(
        buildLocalFilePlaylistItem({
          id: itemId,
          name: parsed.data.name,
          localMediaId: parsed.data.localMediaId,
          mimeType: parsed.data.mimeType,
          sizeBytes: parsed.data.sizeBytes,
          createdBy: ctx.userId,
        }),
      )
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:add",
        payload: {
          itemId,
          itemName: parsed.data.name,
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
  const parsed = playlistRetrySchema.safeParse(data.payload)
  if (!parsed.success) return

  if (!(await consumePlaylistResolveLimit(ctx))) return

  const state = await ctx.store.get(ctx.roomId)
  if (!state) return
  if (
    !canControlFromConnectionContext(
      state,
      ctx.userId,
      connectionAuthFromContext(ctx),
    )
  ) {
    return
  }

  const item = state.playlist.find((entry) => entry.id === parsed.data.itemId)
  if (!canRetryRemotePlaylistItem(item)) return

  await reresolveRemotePlaylistItem({
    store: ctx.store,
    roomId: ctx.roomId,
    itemId: parsed.data.itemId,
  })
}

export const handlePlaylistItemError: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = playlistItemErrorSchema.safeParse(data.payload)
  if (!parsed.success) return

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const result = applyPlaylistItemError(
        state,
        parsed.data.itemId,
        parsed.data.error,
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
        error: parsed.data.error ?? undefined,
      })
      return true
    },
    { kind: "control+snapshot" },
  )
}

export const handlePlaylistReorder: RoomMessageHandler = async (ctx, data) => {
  const reorderResult = playlistReorderSchema.safeParse(data.payload)
  if (!reorderResult.success) return

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const { from, to } = reorderResult.data
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
  const renameResult = playlistRenameSchema.safeParse(data.payload)
  if (!renameResult.success) return

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const result = applyPlaylistRename(
        state,
        renameResult.data.itemId,
        renameResult.data.name,
      )
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
  const removeResult = playlistRemoveSchema.safeParse(data.payload)
  if (!removeResult.success) return

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const result = applyPlaylistRemove(state, removeResult.data.itemId)
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
    { kind: "control+snapshot" },
  )
}
