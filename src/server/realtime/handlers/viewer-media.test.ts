import { describe, expect, test } from "bun:test"
import { handleSeekPreview } from "@/server/realtime/handlers/seek-preview"
import { handleViewerMediaPreferences } from "@/server/realtime/handlers/viewer-media"
import {
  createHandlerContext,
  createParticipant,
  createRoomState,
  envelope,
  InMemoryRoomStateStore,
} from "@/server/realtime/test-utils/fixtures"
import { VIEWER_MEDIA_BY_ITEM_LIMIT } from "@/zod/types"

describe("seek preview handler interface", () => {
  test("controller can publish seek preview state", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    const ctx = createHandlerContext({ store, userId: "owner" })

    await handleSeekPreview(
      ctx,
      envelope("seek:preview", { targetMs: 4_000, active: true }),
    )
    expect(store.peek("room-1")?.playback.seekPreview).toMatchObject({
      userId: "owner",
      targetMs: 4_000,
      active: true,
    })
  })

  test("guest cannot publish seek preview", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
    await handleSeekPreview(
      createHandlerContext({ store, userId: "guest" }),
      envelope("seek:preview", { targetMs: 4_000, active: true }),
    )
    expect(store.peek("room-1")?.playback.seekPreview).toBeUndefined()
  })
})

describe("viewer media preferences handler interface", () => {
  test("stores stream/text/audio prefs for known item", async () => {
    const store = new InMemoryRoomStateStore(createRoomState())
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
