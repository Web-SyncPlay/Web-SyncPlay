import {
  resolveLocalMediaChunk,
  type LocalMediaChunkPayload,
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
import type { PlaylistMediaStream } from "@/contracts/types"
import {
  localMediaAbrPublishSchema,
  localMediaChunkSchema,
  localMediaReadySchema,
  localMediaWebrtcSignalSchema,
} from "@/contracts/schemas"
import { randomUUID } from "node:crypto"
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

  await setLocalMediaProviderReady(parsed.localMediaId, parsed.ready, {
    ownerUserId: ctx.userId,
  })
}

/**
 * Provider finished packaging lower ABR rungs. Register child metadata and
 * upgrade the playlist item to Auto HLS + combined ladder.
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

  const hlsUrl = `/api/media/local/${encodeURIComponent(parentId)}/hls`
  const mediaStreams: PlaylistMediaStream[] = [
    {
      id: "local-auto",
      src: hlsUrl,
      type: "application/vnd.apple.mpegurl",
      protocol: "m3u8",
      isDefault: true,
      label: "Auto",
      kind: "adaptive",
    },
    ...parsed.variants
      .slice()
      .sort((a, b) => b.height - a.height)
      .map((v) => ({
        id: `local-${v.height}`,
        src: `/api/media/local/${encodeURIComponent(v.localMediaId)}`,
        type: v.mimeType,
        height: v.height,
        bitrate: v.bandwidth,
        label: v.label,
        kind: "combined" as const,
        isDefault: false,
      })),
  ]

  await mutateRoomMessage(
    ctx.store,
    ctx.roomId,
    ctx.userId,
    (state) => {
      const item = state.playlist.find((p) => p.localMediaId === parentId)
      if (!item || item.localOriginUserId !== ctx.userId) return false
      item.playableUrl = hlsUrl
      item.sourceUrl = hlsUrl
      item.durationSeconds = parsed.durationSec
      item.mediaStreams = mediaStreams
      item.defaultStreamId = "local-auto"
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

  const { getRoomBroadcastBus } = await import(
    "@/server/realtime/broadcast/room-broadcast-bus"
  )
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
