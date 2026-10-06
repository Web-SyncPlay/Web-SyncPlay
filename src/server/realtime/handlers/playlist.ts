import { env } from "@/env"
import { appendActionLog } from "@/server/log"
import { createLocalMediaEntry } from "@/server/media/local-media-store"
import {
  resolvePlaylistItem,
  reresolveRemotePlaylistItem,
} from "@/server/realtime/services/playlist-resolve"
import { nextMonotonicMs } from "@/server/realtime/services/timeline"
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
import { mutateControlledRoomMessage } from "./mutate-controlled"
import type { RoomMessageHandler } from "./types"

const LOCAL_MIME_PREFIXES = ["video/", "audio/"]

export const handlePlaylistSelect: RoomMessageHandler = async (ctx, data) => {
  const selectResult = playlistSelectSchema.safeParse(data.payload)
  if (!selectResult.success) return

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      const nextIndex = selectResult.data.index
      if (nextIndex >= 0 && nextIndex < state.playlist.length) {
        state.currentIndex = nextIndex
        state.playback.timelineAnchorMs = 0
        state.playback.serverNowMs = nextMonotonicMs(
          state.playback.serverNowMs,
          Date.now(),
        )
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
      }
      return true
    },
    { kind: "control" },
  )
}

export const handlePlaylistAddUrl: RoomMessageHandler = async (ctx, data) => {
  const addUrlResult = playlistAddUrlSchema.safeParse(data.payload)
  if (!addUrlResult.success) return

  const resolveLimit = await consumeRateLimit({
    key: `resolve:${ctx.roomId}:${ctx.userId}`,
    limit: 10,
    windowMs: 60_000,
  })
  if (!resolveLimit.allowed) {
    return
  }

  const queuedItemId = randomUUID()
  const sourceUrl = addUrlResult.data.url
  let shouldResolve = false

  await mutateControlledRoomMessage(
    ctx,
    (state, participant) => {
      if (state.playlist.length >= env.ROOM_PLAYLIST_LIMIT) {
        return false
      }
      shouldResolve = true
      state.playlist.push({
        id: queuedItemId,
        name: sourceUrl,
        sourceKind: "remote_url",
        playbackMode: "direct",
        sourceUrl,
        playableUrl: sourceUrl,
        ingestStatus: "resolving",
        createdBy: ctx.userId,
        createdAt: Date.now(),
      })
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

  if (!shouldResolve) {
    return
  }

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

  if (
    !LOCAL_MIME_PREFIXES.some((prefix) =>
      parsed.data.mimeType.toLowerCase().startsWith(prefix),
    )
  ) {
    return
  }

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
      if (state.playlist.length >= env.ROOM_PLAYLIST_LIMIT) {
        return false
      }
      const playableUrl = `/api/media/local/${encodeURIComponent(parsed.data.localMediaId)}`
      state.playlist.push({
        id: itemId,
        name: parsed.data.name,
        sourceKind: "local_file",
        playbackMode: "direct",
        sourceUrl: playableUrl,
        playableUrl,
        ingestStatus: "ready",
        mediaStreams: [
          {
            id: "local-default",
            src: playableUrl,
            type: parsed.data.mimeType,
            isDefault: true,
            label: "Local",
            kind: "combined",
          },
        ],
        defaultStreamId: "local-default",
        localMediaId: parsed.data.localMediaId,
        localOriginUserId: ctx.userId,
        localMimeType: parsed.data.mimeType,
        localSizeBytes: parsed.data.sizeBytes,
        createdBy: ctx.userId,
        createdAt: Date.now(),
      })
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

  const resolveLimit = await consumeRateLimit({
    key: `resolve:${ctx.roomId}:${ctx.userId}`,
    limit: 10,
    windowMs: 60_000,
  })
  if (!resolveLimit.allowed) {
    return
  }

  // Permission / item gate only — mutation happens in reresolveRemotePlaylistItem.
  let canRetry = false
  await mutateControlledRoomMessage(ctx, (state) => {
    const item = state.playlist.find(
      (entry) => entry.id === parsed.data.itemId,
    )
    if (!item) return false
    if (item.blockedReason === "local_owner_offline") return false
    if (item.sourceKind !== "remote_url") return false
    canRetry = true
    return false
  })

  if (!canRetry) return

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
      const index = state.playlist.findIndex(
        (entry) => entry.id === parsed.data.itemId,
      )
      if (index < 0) return false
      const item = state.playlist[index]
      if (!item) return false

      if (parsed.data.error === null) {
        if (item.ingestStatus !== "error" && !item.ingestError) {
          return false
        }
        item.ingestStatus = "ready"
        item.ingestError = undefined
        return true
      }

      item.ingestStatus = "error"
      item.ingestError = parsed.data.error

      if (state.currentIndex === index && state.playlist.length > 1) {
        const nextIndex = Math.min(state.playlist.length - 1, index + 1)
        if (nextIndex !== index) {
          state.currentIndex = nextIndex
          state.playback.timelineAnchorMs = 0
          state.playback.serverNowMs = nextMonotonicMs(
            state.playback.serverNowMs,
            Date.now(),
          )
          state.playback.paused = true
        }
      }
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "participant:error",
        payload: {
          itemId: item.id,
          mediaName: item.name,
        },
        error: parsed.data.error,
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
      if (
        from >= 0 &&
        to >= 0 &&
        from < state.playlist.length &&
        to < state.playlist.length
      ) {
        const currentMediaId = state.playlist[state.currentIndex]?.id
        const [entry] = state.playlist.splice(from, 1)
        if (entry) state.playlist.splice(to, 0, entry)
        if (entry) {
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
        }
        if (currentMediaId) {
          const nextCurrentIndex = state.playlist.findIndex(
            (item) => item.id === currentMediaId,
          )
          if (nextCurrentIndex >= 0) state.currentIndex = nextCurrentIndex
        }
      }
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
      const item = state.playlist.find(
        (entry) => entry.id === renameResult.data.itemId,
      )
      if (!item) {
        return false
      }
      const nextName = renameResult.data.name.trim()
      if (!nextName || nextName === item.name) {
        return false
      }
      const previousName = item.name
      item.name = nextName
      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:rename",
        payload: {
          itemId: item.id,
          previousName,
          nextName,
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
      const index = state.playlist.findIndex(
        (entry) => entry.id === removeResult.data.itemId,
      )
      if (index < 0) {
        return false
      }
      const [removed] = state.playlist.splice(index, 1)
      if (!removed) {
        return false
      }

      if (state.playlist.length === 0) {
        state.currentIndex = 0
        state.playback.timelineAnchorMs = 0
        state.playback.paused = true
        state.playback.serverNowMs = nextMonotonicMs(
          state.playback.serverNowMs,
          Date.now(),
        )
      } else if (index < state.currentIndex) {
        state.currentIndex -= 1
      } else if (index === state.currentIndex) {
        state.currentIndex = Math.min(index, state.playlist.length - 1)
        state.playback.timelineAnchorMs = 0
        state.playback.serverNowMs = nextMonotonicMs(
          state.playback.serverNowMs,
          Date.now(),
        )
      }

      appendActionLog(state, {
        roomId: ctx.roomId,
        actorUserId: ctx.userId,
        actorUsername: participant.username,
        action: "playlist:remove",
        payload: {
          itemId: removed.id,
          itemName: removed.name,
          index,
        },
      })
      return true
    },
    { kind: "control+snapshot" },
  )
}
