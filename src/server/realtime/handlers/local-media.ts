import { randomUUID } from "node:crypto"

import {
  localMediaAbrPublishSchema,
  localMediaChunkSchema,
  localMediaReadySchema,
  localMediaWebrtcSignalSchema,
} from "@/contracts/schemas"
import type { PlaylistMediaStream } from "@/contracts/types"
import {
  type LocalMediaChunkPayload,
  resolveLocalMediaChunk,
} from "@/server/media/local-media-relay"
import {
  createLocalMediaEntry,
  deleteLocalMediaEntry,
  getLocalMediaEntry,
  setLocalMediaAbr,
  setLocalMediaProviderReady,
} from "@/server/media/local-media-store"
import { mutateRoomMessage } from "@/server/realtime/handlers/mutate-room"
import type { RoomMessageHandler } from "@/server/realtime/handlers/types"

import { parseOrNack } from "./parse-or-nack"
import { parseOrWarn } from "./parse-or-warn"

export const handleLocalMediaChunk: RoomMessageHandler = async (_ctx, data) => {
  const parsed = parseOrWarn(localMediaChunkSchema, data.payload, data.type)
  if (!parsed) return

  const payload: LocalMediaChunkPayload = {
    requestId: parsed.requestId,
    ok: parsed.ok,
    dataBase64: parsed.dataBase64,
    error: parsed.error,
  }
  resolveLocalMediaChunk(payload)
}

export const handleLocalMediaReady: RoomMessageHandler = async (ctx, data) => {
  const parsed = parseOrNack(localMediaReadySchema, ctx.ws, data)
  if (!parsed) return

  if (parsed.ready) {
    let entry = await getLocalMediaEntry(parsed.localMediaId)
    if (!entry) {
      // After prune (or older disconnect paths) Redis metadata may be gone;
      // recreate from playlist when the owner re-announces they still hold the File.
      const state = await ctx.store.get(ctx.roomId)
      const item = state?.playlist.find(
        (playlistItem) =>
          playlistItem.localMediaId === parsed.localMediaId &&
          playlistItem.localOriginUserId === ctx.userId &&
          playlistItem.sourceKind === "local_file",
      )
      if (item?.localMimeType && item.localSizeBytes != null) {
        try {
          await createLocalMediaEntry({
            id: parsed.localMediaId,
            roomId: ctx.roomId,
            ownerUserId: ctx.userId,
            filename: item.name || "Local media",
            mimeType: item.localMimeType,
            sizeBytes: item.localSizeBytes,
            providerReady: true,
          })
          entry = await getLocalMediaEntry(parsed.localMediaId)
        } catch (error) {
          console.error(
            "[local-media] failed to recreate metadata on ready",
            error,
          )
        }
      }
    } else {
      await setLocalMediaProviderReady(parsed.localMediaId, true, {
        ownerUserId: ctx.userId,
      })
    }

    if (entry || (await getLocalMediaEntry(parsed.localMediaId))) {
      await mutateRoomMessage(
        ctx.store,
        ctx.roomId,
        ctx.userId,
        (state) => {
          let changed = false
          for (const playlistItem of state.playlist) {
            if (playlistItem.localMediaId !== parsed.localMediaId) continue
            if (playlistItem.localOriginUserId !== ctx.userId) continue
            if (
              playlistItem.blockedReason !== "local_owner_offline" &&
              playlistItem.ingestStatus !== "error"
            ) {
              continue
            }
            playlistItem.blockedReason = undefined
            playlistItem.ingestError = undefined
            playlistItem.ingestStatus = "ready"
            changed = true
          }
          return changed
        },
        { kind: "snapshot" },
      )
    }
    return
  }

  await setLocalMediaProviderReady(parsed.localMediaId, false, {
    ownerUserId: ctx.userId,
  })
}

/**
 * Provider finished packaging lower ABR rungs. Register child metadata and
 * upgrade the playlist item to a progressive ladder (plus optional Auto HLS).
 */
export const handleLocalMediaAbrPublish: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrNack(localMediaAbrPublishSchema, ctx.ws, data)
  if (!parsed) return

  const parent = await getLocalMediaEntry(parsed.parentLocalMediaId)
  if (!parent || parent.ownerUserId !== ctx.userId) return
  if (parent.roomId !== ctx.roomId) return
  if (parent.abrParentId) return

  const parentId = parent.id
  const hasParentVariant = parsed.variants.some(
    (v) => v.localMediaId === parentId,
  )
  if (!hasParentVariant) return

  // Drop previous children before registering the new ladder.
  if (parent.abr?.variants?.length) {
    for (const prev of parent.abr.variants) {
      if (prev.localMediaId === parentId) continue
      await deleteLocalMediaEntry(prev.localMediaId)
    }
  }

  for (const variant of parsed.variants) {
    if (variant.localMediaId === parentId) continue
    try {
      await createLocalMediaEntry({
        id: variant.localMediaId,
        roomId: ctx.roomId,
        ownerUserId: ctx.userId,
        filename: variant.name,
        mimeType: variant.mimeType,
        sizeBytes: variant.sizeBytes,
        providerReady: true,
        abrParentId: parentId,
      })
    } catch (error) {
      console.error("[local-media] failed to register ABR child", error)
      return
    }
  }

  const abrVariants = parsed.variants.map((v) => ({
    localMediaId: v.localMediaId,
    height: v.height,
    bandwidth: v.bandwidth,
    label: v.label,
  }))

  const updated = await setLocalMediaAbr(
    parentId,
    {
      status: "ready",
      durationSec: parsed.durationSec,
      variants: abrVariants,
    },
    { ownerUserId: ctx.userId },
  )
  if (!updated) return

  // Progressive ladder first: whole-file MP4 as an HLS media segment breaks
  // hls.js remux (no EXTM3U on blob / baseTime null). Keep Auto HLS available
  // but default to the highest progressive rung so guests/host keep playing.
  const progressiveStreams = parsed.variants
    .slice()
    .sort((a, b) => b.height - a.height)
    .map((v, index) => ({
      id: `local-${v.height}`,
      src: `/api/media/local/${encodeURIComponent(v.localMediaId)}`,
      type: v.mimeType,
      height: v.height,
      bitrate: v.bandwidth,
      label: v.label,
      kind: "combined" as const,
      isDefault: index === 0,
    }))
  const defaultProgressive = progressiveStreams[0]
  if (!defaultProgressive) return

  const hlsUrl = `/api/media/local/${encodeURIComponent(parentId)}/hls`
  const mediaStreams: PlaylistMediaStream[] = [
    ...progressiveStreams,
    {
      id: "local-auto",
      src: hlsUrl,
      type: "application/vnd.apple.mpegurl",
      protocol: "m3u8",
      isDefault: false,
      label: "Auto",
      kind: "adaptive",
    },
  ]

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state) => {
      const item = state.playlist.find((p) => p.localMediaId === parentId)
      if (!item || item.localOriginUserId !== ctx.userId) return false
      item.playableUrl = defaultProgressive.src
      item.sourceUrl = defaultProgressive.src
      item.durationSeconds = parsed.durationSec
      item.mediaStreams = mediaStreams
      item.defaultStreamId = defaultProgressive.id
      item.ingestStatus = "ready"
      return true
    },
    { kind: "snapshot" },
  )
}

/**
 * Relay WebRTC signaling between peers in the same room.
 * Does not interpret SDP — fan-out via Redis so cross-replica peers receive it.
 */
export const handleLocalMediaWebrtcSignal: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrWarn(
    localMediaWebrtcSignalSchema,
    data.payload,
    data.type,
  )
  if (!parsed) return
  if (parsed.targetUserId === ctx.userId) return

  const { getRoomBroadcastBus } =
    await import("@/server/realtime/broadcast/room-broadcast-bus")
  await getRoomBroadcastBus().publishUserEphemeral(
    ctx.roomId,
    parsed.targetUserId,
    {
      type: "local-media:webrtc:signal",
      requestId: randomUUID(),
      payload: {
        localMediaId: parsed.localMediaId,
        fromUserId: ctx.userId,
        signal: parsed.signal,
      },
    },
  )
}
