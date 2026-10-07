import { afterEach, describe, expect, test } from "bun:test"
import {
  createTestBroadcastBus,
  setRoomBroadcastBusForTests,
} from "@/server/realtime/broadcast/room-broadcast-bus"
import { handleSeekPreview } from "@/server/realtime/handlers/seek-preview"
import {
  applyViewerMediaPreferences,
  capViewerMediaByItemId,
  handleViewerMediaPreferences,
  mergeViewerMediaItemPreference,
} from "@/server/realtime/handlers/viewer-media"
import {
  createHandlerContext,
  createParticipant,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { VIEWER_MEDIA_BY_ITEM_LIMIT, type PlaylistItem } from "@/zod/types"

describe("seek preview handler interface", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("controller publishes ephemeral control without room write", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleSeekPreview(
      ctx,
      envelope("seek:preview", { targetMs: 4_000, active: true }),
    )
    expect(store.peek("room-1")?.playback.seekPreview).toBeUndefined()
    const control = bus.captured.find((c) => c.envelope.type === "room:control")
    expect(control).toBeDefined()
    const payload = control!.envelope.payload as {
      playback: { seekPreview?: { targetMs: number; active: boolean } }
    }
    expect(payload.playback.seekPreview).toMatchObject({
      targetMs: 4_000,
      active: true,
    })
  })

  test("ending seek preview persists timeline for peers", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleSeekPreview(
      ctx,
      envelope("seek:preview", { targetMs: 12_500, active: false }),
    )

    const next = store.peek("room-1")
    expect(next?.playback.timelineAnchorMs).toBe(12_500)
    expect(next?.playback.seekPreview).toBeUndefined()
    expect(next?.actionLog.at(-1)?.action).toBe("playback:seek")
  })

  test("guest cannot publish seek preview", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const bus = createTestBroadcastBus(store)
    await handleSeekPreview(
      createHandlerContext({ store, userId: "guest" }),
      envelope("seek:preview", { targetMs: 4_000, active: true }),
    )
    expect(store.peek("room-1")?.playback.seekPreview).toBeUndefined()
    expect(bus.captured.length).toBe(0)
  })
})

describe("viewer media preference helpers", () => {
  const item = {
    id: "item-c",
    mediaStreams: [{ id: "stream-1" }],
    textTracks: [{ id: "track-1" }],
  } as PlaylistItem

  test("merge rejects unknown catalog ids and accepts clears", () => {
    expect(
      mergeViewerMediaItemPreference(item, undefined, {
        itemId: "item-c",
        streamId: "missing",
      }),
    ).toBeNull()
    expect(
      mergeViewerMediaItemPreference(item, { streamId: "stream-1" }, {
        itemId: "item-c",
        streamId: null,
        textTrackId: "track-1",
        audioLanguage: "en",
      }),
    ).toEqual({
      streamId: undefined,
      textTrackId: "track-1",
      audioLanguage: "en",
    })
  })

  test("cap keeps the newest entries within the limit", () => {
    const byItemId: Record<string, { streamId: string }> = {}
    for (let i = 0; i < VIEWER_MEDIA_BY_ITEM_LIMIT + 2; i += 1) {
      byItemId[`old-${i}`] = { streamId: "stream-1" }
    }
    const capped = capViewerMediaByItemId({ byItemId })
    expect(Object.keys(capped.byItemId)).toHaveLength(VIEWER_MEDIA_BY_ITEM_LIMIT)
    expect(capped.byItemId[`old-${VIEWER_MEDIA_BY_ITEM_LIMIT + 1}`]).toBeDefined()
    expect(capped.byItemId["old-0"]).toBeUndefined()
  })

  test("apply writes merged prefs onto the participant", () => {
    const participant = createParticipant({ userId: "guest", role: "guest" })
    expect(
      applyViewerMediaPreferences(participant, item, {
        itemId: "item-c",
        streamId: "stream-1",
      }),
    ).toBe(true)
    expect(participant.viewerMedia?.byItemId["item-c"]).toEqual({
      streamId: "stream-1",
    })
  })
})

describe("viewer media preferences handler interface", () => {
  afterEach(() => {
    setRoomBroadcastBusForTests(null)
  })

  test("stores stream/text/audio prefs for known item", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handleViewerMediaPreferences(
      ctx,
      envelope("viewer:media:preferences", {
        itemId: "item-c",
        streamId: "stream-1",
        textTrackId: "track-1",
        audioLanguage: "en",
      }),
    )

    expect(
      store.peek("room-1")?.participants.guest?.viewerMedia?.byItemId["item-c"],
    ).toEqual({
      streamId: "stream-1",
      textTrackId: "track-1",
      audioLanguage: "en",
    })
  })

  test("rejects unknown stream/text track ids", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handleViewerMediaPreferences(
      ctx,
      envelope("viewer:media:preferences", {
        itemId: "item-c",
        streamId: "missing",
      }),
    )
    expect(
      store.peek("room-1")?.participants.guest?.viewerMedia,
    ).toBeUndefined()
  })

  test("caps byItemId map to VIEWER_MEDIA_BY_ITEM_LIMIT", async () => {
    const byItemId: Record<string, { streamId: string }> = {}
    for (let i = 0; i < VIEWER_MEDIA_BY_ITEM_LIMIT; i += 1) {
      byItemId[`old-${i}`] = { streamId: "stream-1" }
    }
    const store = new InMemoryRoomStateStore(
      createRoomState({
        participants: {
          owner: createParticipant({ userId: "owner", role: "owner" }),
          guest: createParticipant({
            userId: "guest",
            role: "guest",
            viewerMedia: { byItemId },
          }),
          mod: createParticipant({ userId: "mod", role: "moderator" }),
        },
      }),
    )
    createTestBroadcastBus(store)
    const ctx = createHandlerContext({ store, userId: "guest" })

    await handleViewerMediaPreferences(
      ctx,
      envelope("viewer:media:preferences", {
        itemId: "item-c",
        streamId: "stream-1",
      }),
    )

    const prefs = store.peek("room-1")?.participants.guest?.viewerMedia?.byItemId
    expect(Object.keys(prefs ?? {}).length).toBe(VIEWER_MEDIA_BY_ITEM_LIMIT)
    expect(prefs?.["item-c"]).toBeDefined()
  })
})
