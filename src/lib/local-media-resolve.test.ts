import { describe, expect, test } from "bun:test"
import {
  rememberAbrVariantMeta,
} from "@/lib/local-media-abr"
import {
  findLocalPlaylistItemForMediaId,
  localMediaIdFromSrc,
  resolveLocalMediaMeta,
  resolveLocalMediaProviderUserId,
} from "@/lib/local-media-resolve"
import type { PlaylistItem, RoomState } from "@/zod/types"

const parentId = "00000000-0000-4000-8000-000000000001"
const childId = "00000000-0000-4000-8000-0000000000cc"

function localItem(partial: Partial<PlaylistItem> = {}): PlaylistItem {
  return {
    id: "item-1",
    name: "Local",
    sourceUrl: `local-media://${parentId}`,
    playableUrl: `/api/media/local/${parentId}`,
    sourceKind: "local_file",
    playbackMode: "direct",
    localMediaId: parentId,
    localOriginUserId: "provider-1",
    localMimeType: "video/mp4",
    localSizeBytes: 4_000_000,
    durationSeconds: 120,
    createdBy: "provider-1",
    createdAt: 1,
    ...partial,
  }
}

function roomWithPlaylist(playlist: PlaylistItem[]): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 1,
      defaultJoinRole: "guest",
    },
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: 0,
      videoLoop: "off",
      playlistLoop: "off",
    },
    playlist,
    currentIndex: 0,
    participants: {},
    actionLog: [],
    updatedAt: 0,
    generation: 0,
    structuralRevision: 0,
  }
}

describe("localMediaIdFromSrc", () => {
  test("extracts id from local media URLs", () => {
    expect(localMediaIdFromSrc(`/api/media/local/${parentId}`)).toBe(parentId)
    expect(localMediaIdFromSrc(`/api/media/local/${parentId}/hls`)).toBe(
      parentId,
    )
    expect(
      localMediaIdFromSrc(
        `https://app.example/api/media/local/${encodeURIComponent(parentId)}?x=1`,
      ),
    ).toBe(parentId)
  })

  test("returns null for missing or non-local src", () => {
    expect(localMediaIdFromSrc(undefined)).toBeNull()
    expect(localMediaIdFromSrc("blob:https://app/1")).toBeNull()
    expect(localMediaIdFromSrc("/api/media/proxy/x")).toBeNull()
  })
})

describe("findLocalPlaylistItemForMediaId", () => {
  test("matches primary localMediaId and stream src", () => {
    const item = localItem({
      mediaStreams: [
        {
          id: "v1",
          src: `/api/media/local/${childId}`,
          kind: "combined",
          type: "video/mp4",
        },
      ],
    })
    const room = roomWithPlaylist([item])

    expect(findLocalPlaylistItemForMediaId(room, parentId)).toBe(item)
    expect(findLocalPlaylistItemForMediaId(room, childId)).toBe(item)
  })

  test("matches HLS master path prefix", () => {
    const item = localItem({
      mediaStreams: [
        {
          id: "hls",
          src: `/api/media/local/${parentId}/hls`,
          kind: "adaptive",
          type: "application/vnd.apple.mpegurl",
        },
      ],
    })
    const room = roomWithPlaylist([item])
    expect(findLocalPlaylistItemForMediaId(room, parentId)).toBe(item)
  })

  test("ignores remote items and missing room state", () => {
    const remote = localItem({
      sourceKind: "remote_url",
      sourceUrl: "https://example.com/a.mp4",
      playableUrl: "https://example.com/a.mp4",
    })
    expect(findLocalPlaylistItemForMediaId(roomWithPlaylist([remote]), parentId)).toBeNull()
    expect(findLocalPlaylistItemForMediaId(null, parentId)).toBeNull()
  })
})

describe("resolveLocalMediaProviderUserId", () => {
  test("returns localOriginUserId for known media", () => {
    const room = roomWithPlaylist([localItem()])
    expect(resolveLocalMediaProviderUserId(room, parentId)).toBe("provider-1")
    expect(resolveLocalMediaProviderUserId(room, "missing")).toBeNull()
  })
})

describe("resolveLocalMediaMeta", () => {
  test("prefers remembered ABR variant metadata", () => {
    rememberAbrVariantMeta(childId, {
      mimeType: "video/mp4",
      sizeBytes: 900_000,
      parentLocalMediaId: parentId,
    })
    const room = roomWithPlaylist([localItem()])
    expect(resolveLocalMediaMeta(room, childId)).toEqual({
      mimeType: "video/mp4",
      sizeBytes: 900_000,
    })
  })

  test("returns parent file mime and size", () => {
    const room = roomWithPlaylist([localItem()])
    expect(resolveLocalMediaMeta(room, parentId)).toEqual({
      mimeType: "video/mp4",
      sizeBytes: 4_000_000,
    })
  })

  test("approximates child size from bitrate and duration", () => {
    const variantId = "00000000-0000-4000-8000-0000000000dd"
    const item = localItem({
      mediaStreams: [
        {
          id: "v1",
          src: `/api/media/local/${variantId}`,
          kind: "combined",
          type: "video/mp4",
          bitrate: 2_000_000,
        },
      ],
    })
    const room = roomWithPlaylist([item])
    expect(resolveLocalMediaMeta(room, variantId)).toEqual({
      mimeType: "video/mp4",
      sizeBytes: Math.round((2_000_000 * 120) / 8),
    })
  })
})
