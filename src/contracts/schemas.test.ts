import { describe, expect, test } from "bun:test"
import { roomMessageHandlers } from "@/server/realtime/handlers"
import {
  roomMessageSchemas,
  type ClientEventType,
} from "@/contracts/room-events"
import {
  actionLogEntrySchema,
  participantStateSchema,
  playlistItemSchema,
  roomErrorPayloadSchema,
  roomSnapshotPayloadSchema,
  serverEventSchemas,
  viewerMediaPreferencesStateSchema,
} from "@/contracts/s2c"
import {
  participantRoleUpdateSchema,
  participantUpdateSchema,
  playbackLoopModeSchema,
  playbackRateSchema,
  playbackSeekSchema,
  playbackSetPausedSchema,
  localMediaReadySchema,
  localMediaAbrPublishSchema,
  playlistAddLocalSchema,
  playlistAddUrlSchema,
  playlistItemDurationSchema,
  playlistItemErrorSchema,
  playlistRemoveSchema,
  playlistRenameSchema,
  playlistReorderSchema,
  playlistRetrySchema,
  playlistSelectSchema,
  roomErrorCodeSchema,
  roomJoinSchema,
  roomPasswordClearSchema,
  roomPasswordSetSchema,
  roomDefaultRoleSetSchema,
  seekPreviewSchema,
  viewerMediaPreferencesSchema,
  wsEnvelopeSchema,
} from "@/contracts/schemas"

const roomMessageEventTypes = Object.keys(
  roomMessageSchemas,
) as ClientEventType[]

describe("transport envelope interface", () => {
  test("accepts minimal valid envelope", () => {
    const result = wsEnvelopeSchema.safeParse({
      type: "playback:seek",
      payload: { targetMs: 1 },
    })
    expect(result.success).toBe(true)
  })

  test("rejects missing type or payload", () => {
    expect(wsEnvelopeSchema.safeParse({ payload: {} }).success).toBe(false)
    expect(wsEnvelopeSchema.safeParse({ type: "x" }).success).toBe(false)
    expect(wsEnvelopeSchema.safeParse({ type: "", payload: {} }).success).toBe(
      false,
    )
  })

  test("accepts optional requestId and sourceUserId", () => {
    const result = wsEnvelopeSchema.safeParse({
      type: "participant:update",
      requestId: "req-1",
      sourceUserId: "user-1",
      payload: { username: "Ada" },
    })
    expect(result.success).toBe(true)
  })
})

describe("room:join interface", () => {
  test("requires roomId and userSecret", () => {
    expect(roomJoinSchema.safeParse({}).success).toBe(false)
    expect(
      roomJoinSchema.safeParse({
        roomId: "r1",
        userSecret: "secret",
      }).success,
    ).toBe(true)
  })

  test("defaults sessionKind to room", () => {
    const result = roomJoinSchema.safeParse({
      roomId: "r1",
      userSecret: "secret",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionKind).toBe("room")
    }
  })

  test("accepts embed sessionKind", () => {
    const result = roomJoinSchema.safeParse({
      roomId: "r1",
      userSecret: "secret",
      sessionKind: "embed",
      initialMediaUrl: "https://youtu.be/abc",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionKind).toBe("embed")
      expect(result.data.initialMediaUrl).toBe("https://youtu.be/abc")
    }
  })

  test("accepts non-url initialMediaUrl strings for server-side create checks", () => {
    const result = roomJoinSchema.safeParse({
      roomId: "r1",
      userSecret: "secret",
      initialMediaUrl: "ftp://files.example.com/a.mp4",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.initialMediaUrl).toBe("ftp://files.example.com/a.mp4")
    }
  })

  test("rejects oversized username / password", () => {
    expect(
      roomJoinSchema.safeParse({
        roomId: "r1",
        userSecret: "secret",
        username: "x".repeat(65),
      }).success,
    ).toBe(false)
    expect(
      roomJoinSchema.safeParse({
        roomId: "r1",
        userSecret: "secret",
        joinPassword: "x".repeat(257),
      }).success,
    ).toBe(false)
  })
})

describe("playback payload interfaces", () => {
  test("seek bounds", () => {
    expect(playbackSeekSchema.safeParse({ targetMs: 0 }).success).toBe(true)
    expect(playbackSeekSchema.safeParse({ targetMs: -1 }).success).toBe(false)
    expect(
      playbackSeekSchema.safeParse({ targetMs: 1000 * 60 * 60 * 24 }).success,
    ).toBe(true)
    expect(
      playbackSeekSchema.safeParse({
        targetMs: 1000 * 60 * 60 * 24 + 1,
      }).success,
    ).toBe(false)
  })

  test("rate bounds", () => {
    expect(playbackRateSchema.safeParse({ playbackRate: 0.25 }).success).toBe(
      true,
    )
    expect(playbackRateSchema.safeParse({ playbackRate: 3 }).success).toBe(true)
    expect(playbackRateSchema.safeParse({ playbackRate: 0.24 }).success).toBe(
      false,
    )
    expect(playbackRateSchema.safeParse({ playbackRate: 3.01 }).success).toBe(
      false,
    )
  })

  test("play/pause optional currentTimeMs", () => {
    expect(playbackSetPausedSchema.safeParse({}).success).toBe(true)
    expect(
      playbackSetPausedSchema.safeParse({ currentTimeMs: 10 }).success,
    ).toBe(true)
    expect(
      playbackSetPausedSchema.safeParse({ currentTimeMs: -1 }).success,
    ).toBe(false)
  })

  test("loop modes", () => {
    for (const mode of ["off", "once", "always"] as const) {
      expect(playbackLoopModeSchema.safeParse({ mode }).success).toBe(true)
    }
    expect(playbackLoopModeSchema.safeParse({ mode: "forever" }).success).toBe(
      false,
    )
  })
})

describe("playlist payload interfaces", () => {
  test("select requires non-negative int index", () => {
    expect(playlistSelectSchema.safeParse({ index: 0 }).success).toBe(true)
    expect(playlistSelectSchema.safeParse({ index: -1 }).success).toBe(false)
    expect(playlistSelectSchema.safeParse({ index: 1.5 }).success).toBe(false)
  })

  test("remove requires itemId", () => {
    expect(
      playlistRemoveSchema.safeParse({ itemId: "item-a" }).success,
    ).toBe(true)
    expect(playlistRemoveSchema.safeParse({ itemId: "" }).success).toBe(false)
  })

  test("reorder requires non-negative ints", () => {
    expect(playlistReorderSchema.safeParse({ from: 0, to: 1 }).success).toBe(
      true,
    )
    expect(playlistReorderSchema.safeParse({ from: -1, to: 0 }).success).toBe(
      false,
    )
  })

  test("add url validates URL shape", () => {
    expect(
      playlistAddUrlSchema.safeParse({ url: "https://example.com/a" }).success,
    ).toBe(true)
    expect(playlistAddUrlSchema.safeParse({ url: "not-a-url" }).success).toBe(
      false,
    )
  })

  test("add local / rename / retry / item error", () => {
    expect(
      playlistAddLocalSchema.safeParse({
        localMediaId: "00000000-0000-4000-8000-000000000001",
        name: "clip",
        mimeType: "video/mp4",
        sizeBytes: 1024,
      }).success,
    ).toBe(true)
    expect(
      playlistAddLocalSchema.safeParse({
        localMediaId: "m1",
        name: "clip",
      }).success,
    ).toBe(false)
    expect(
      localMediaReadySchema.safeParse({
        localMediaId: "00000000-0000-4000-8000-000000000001",
        ready: true,
      }).success,
    ).toBe(true)
    expect(
      localMediaReadySchema.safeParse({
        localMediaId: "not-a-uuid",
        ready: false,
      }).success,
    ).toBe(false)
    expect(
      localMediaAbrPublishSchema.safeParse({
        parentLocalMediaId: "00000000-0000-4000-8000-000000000001",
        durationSec: 12.5,
        variants: [
          {
            localMediaId: "00000000-0000-4000-8000-000000000001",
            height: 1080,
            bandwidth: 5_000_000,
            label: "1080p",
            mimeType: "video/mp4",
            sizeBytes: 1_000_000,
            name: "clip",
          },
        ],
      }).success,
    ).toBe(true)
    expect(
      localMediaAbrPublishSchema.safeParse({
        parentLocalMediaId: "00000000-0000-4000-8000-000000000001",
        durationSec: 12.5,
        variants: [],
      }).success,
    ).toBe(false)
    expect(
      playlistRenameSchema.safeParse({ itemId: "i1", name: "" }).success,
    ).toBe(false)
    expect(playlistRetrySchema.safeParse({ itemId: "i1" }).success).toBe(true)
    expect(
      playlistItemErrorSchema.safeParse({
        itemId: "i1",
        error: "x".repeat(301),
      }).success,
    ).toBe(false)
    expect(
      playlistItemErrorSchema.safeParse({
        itemId: "i1",
        error: null,
      }).success,
    ).toBe(true)
    expect(
      playlistItemDurationSchema.safeParse({
        itemId: "i1",
        durationSeconds: 125.5,
      }).success,
    ).toBe(true)
    expect(
      playlistItemDurationSchema.safeParse({
        itemId: "i1",
        durationSeconds: 0,
      }).success,
    ).toBe(false)
    expect(
      playlistAddLocalSchema.safeParse({
        localMediaId: "00000000-0000-4000-8000-000000000001",
        name: "clip",
        mimeType: "video/mp4",
        sizeBytes: 1024,
        durationSeconds: 40,
      }).success,
    ).toBe(true)
  })
})

describe("participant / room / viewer interfaces", () => {
  test("participant update field bounds", () => {
    expect(
      participantUpdateSchema.safeParse({ username: "Ada" }).success,
    ).toBe(true)
    expect(
      participantUpdateSchema.safeParse({ username: "x".repeat(65) }).success,
    ).toBe(false)
    expect(
      participantUpdateSchema.safeParse({ error: "x".repeat(301) }).success,
    ).toBe(false)
  })

  test("rejects XSS-packaged usernames / errors; strips title markup", () => {
    expect(
      participantUpdateSchema.safeParse({
        username: "<script>alert(1)</script>",
      }).success,
    ).toBe(false)
    expect(
      participantUpdateSchema.safeParse({
        error: '<img src=x onerror=alert(1)>',
      }).success,
    ).toBe(false)
    expect(
      playlistRenameSchema.safeParse({
        itemId: "i1",
        name: "Track <script>",
      }).success,
    ).toBe(true)
    const renamed = playlistRenameSchema.safeParse({
      itemId: "i1",
      name: "Track <script>",
    })
    expect(renamed.success && renamed.data.name).toBe("Track script")
  })

  test("role update rejects invalid role", () => {
    expect(
      participantRoleUpdateSchema.safeParse({
        targetUserId: "g1",
        role: "moderator",
      }).success,
    ).toBe(true)
    expect(
      participantRoleUpdateSchema.safeParse({
        targetUserId: "g1",
        role: "admin",
      }).success,
    ).toBe(false)
    expect(
      participantRoleUpdateSchema.safeParse({
        targetUserId: "g1",
        role: "owner",
      }).success,
    ).toBe(false)
  })

  test("room password set/clear", () => {
    expect(roomPasswordSetSchema.safeParse({ password: "secret" }).success).toBe(
      true,
    )
    expect(roomPasswordSetSchema.safeParse({ password: "" }).success).toBe(
      false,
    )
    expect(roomPasswordClearSchema.safeParse({}).success).toBe(true)
  })

  test("room default role set", () => {
    expect(
      roomDefaultRoleSetSchema.safeParse({ role: "moderator" }).success,
    ).toBe(true)
    expect(roomDefaultRoleSetSchema.safeParse({ role: "guest" }).success).toBe(
      true,
    )
    expect(roomDefaultRoleSetSchema.safeParse({ role: "owner" }).success).toBe(
      false,
    )
  })

  test("seek preview and viewer prefs", () => {
    expect(seekPreviewSchema.safeParse({ active: true }).success).toBe(true)
    expect(
      viewerMediaPreferencesSchema.safeParse({
        itemId: "i1",
        streamId: null,
        textTrackId: null,
      }).success,
    ).toBe(true)
    expect(viewerMediaPreferencesSchema.safeParse({}).success).toBe(false)
  })
})

describe("room:error mutation nack", () => {
  test("accepts known codes and optional type/message", () => {
    expect(roomErrorCodeSchema.safeParse("unauthorized").success).toBe(true)
    expect(roomErrorCodeSchema.safeParse("sfu_wrong_node").success).toBe(false)
    expect(
      roomErrorPayloadSchema.safeParse({
        code: "invalid_payload",
        type: "playback:seek",
      }).success,
    ).toBe(true)
    expect(serverEventSchemas["room:error"]).toBe(roomErrorPayloadSchema)
  })
})

describe("S2C playlist / participant domain schemas", () => {
  const basePlaylistItem = {
    id: "item-1",
    name: "Clip",
    sourceKind: "remote_url" as const,
    playbackMode: "direct" as const,
    sourceUrl: "https://example.com/a.mp4",
    playableUrl: "https://example.com/a.mp4",
    createdBy: "u1",
    createdAt: 1,
  }

  test("playlist item validates catalog fields and strips unknown keys", () => {
    const result = playlistItemSchema.safeParse({
      ...basePlaylistItem,
      ingestStatus: "ready",
      mediaStreams: [
        {
          id: "s1",
          src: "https://example.com/a.m3u8",
          kind: "adaptive",
          height: 720,
        },
      ],
      textTracks: [
        {
          id: "t1",
          src: "https://example.com/a.vtt",
          label: "English",
          kind: "captions",
        },
      ],
      defaultStreamId: "s1",
      isLive: false,
      legacySelectedStreamId: "drop-me",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.mediaStreams?.[0]?.id).toBe("s1")
      expect(result.data.textTracks?.[0]?.kind).toBe("captions")
      expect(
        "legacySelectedStreamId" in (result.data as Record<string, unknown>),
      ).toBe(false)
    }
    expect(
      playlistItemSchema.safeParse({
        ...basePlaylistItem,
        sourceKind: "torrent",
      }).success,
    ).toBe(false)
    expect(
      playlistItemSchema.safeParse({
        ...basePlaylistItem,
        ingestStatus: "pending",
      }).success,
    ).toBe(false)
  })

  test("participant viewerMedia uses typed item preferences", () => {
    const result = participantStateSchema.safeParse({
      userId: "u1",
      username: "Ada",
      avatarStyle: "bottts",
      role: "guest",
      connected: true,
      localPlayback: {
        paused: true,
        currentTimeMs: 0,
        loading: false,
        updatedAt: 1,
      },
      viewerMedia: {
        byItemId: {
          "item-1": {
            streamId: "s1",
            textTrackId: null,
            audioLanguage: "en",
          },
        },
      },
    })
    expect(result.success).toBe(true)
    expect(
      viewerMediaPreferencesStateSchema.safeParse({
        byItemId: { "item-1": { streamId: 12 } },
      }).success,
    ).toBe(false)
  })

  test("action log accepts optional actorUsername/error without passthrough", () => {
    const result = actionLogEntrySchema.safeParse({
      id: "log-1",
      at: 1,
      roomId: "r1",
      actorUserId: "u1",
      actorUsername: "Ada",
      action: "playlist:add:url",
      payload: { url: "https://example.com" },
      error: "boom",
      extra: "stripped",
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.actorUsername).toBe("Ada")
      expect(result.data.error).toBe("boom")
      expect("extra" in (result.data as Record<string, unknown>)).toBe(false)
    }
  })

  test("room snapshot schema is registered for snapshot and legacy state", () => {
    expect(serverEventSchemas["room:snapshot"]).toBe(roomSnapshotPayloadSchema)
    expect(serverEventSchemas["room:state"]).toBe(roomSnapshotPayloadSchema)
  })
})

describe("contract alignment", () => {
  test("every ClientEventType has a schema and handler", () => {
    for (const type of roomMessageEventTypes) {
      expect(roomMessageSchemas[type]).toBeDefined()
      expect(roomMessageHandlers[type]).toBeDefined()
    }
  })

  test("handler keys exactly match schema keys", () => {
    const schemaKeys = Object.keys(roomMessageSchemas).sort()
    const handlerKeys = Object.keys(roomMessageHandlers).sort()
    expect(handlerKeys).toEqual(schemaKeys)
  })

  test("schema map covers every ClientEventType exactly once", () => {
    const expected = Object.keys(roomMessageSchemas) as ClientEventType[]
    expect(new Set(expected).size).toBe(expected.length)
    expect(expected.length).toBe(roomMessageEventTypes.length)
  })
})
