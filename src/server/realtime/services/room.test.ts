import { describe, expect, test } from "bun:test"
import { InMemoryRoomStateStore } from "@/server/realtime/test-utils/fixtures"
import { createInitialRoomState, evaluateCreateMediaSeed } from "./room"

describe("evaluateCreateMediaSeed", () => {
  test("ignores media when the room already exists", () => {
    expect(
      evaluateCreateMediaSeed({
        roomExists: true,
        initialMediaUrl: "ftp://bad.example/a",
      }),
    ).toEqual({ ok: true })
  })

  test("allows create without media", () => {
    expect(evaluateCreateMediaSeed({ roomExists: false })).toEqual({
      ok: true,
    })
  })

  test("rejects unsafe media on create", () => {
    expect(
      evaluateCreateMediaSeed({
        roomExists: false,
        initialMediaUrl: "ftp://files.example.com/video.mp4",
      }),
    ).toEqual({ ok: false, reason: "media_url_unsupported" })
  })

  test("accepts public http(s) media on create", () => {
    expect(
      evaluateCreateMediaSeed({
        roomExists: false,
        initialMediaUrl: "https://youtu.be/abc123",
      }),
    ).toEqual({ ok: true, seedUrl: "https://youtu.be/abc123" })
  })
})

describe("createInitialRoomState", () => {
  test("seeds playlist from public initialMediaUrl", async () => {
    const store = new InMemoryRoomStateStore()
    const state = await createInitialRoomState(store, "room-seed", "owner", {
      initialMediaUrl: "https://youtu.be/abc123",
    })
    expect(state.playlist).toHaveLength(1)
    expect(state.playlist[0]?.sourceUrl).toBe("https://youtu.be/abc123")
    expect(state.playlist[0]?.ingestStatus).toBe("resolving")
  })

  test("ignores unsafe initialMediaUrl and falls back to daily defaults", async () => {
    const store = new InMemoryRoomStateStore()
    await store.setDailyDefaults([
      { url: "https://example.com/default.mp4", title: "Default" },
    ])
    // Non-http(s) is always rejected by assertPublicHttpUrl (independent of
    // PROXY_ALLOW_PRIVATE_URLS). Page parsing normally blocks this earlier.
    const state = await createInitialRoomState(store, "room-unsafe", "owner", {
      initialMediaUrl: "ftp://files.example.com/video.mp4",
    })
    expect(state.playlist).toHaveLength(1)
    expect(state.playlist[0]?.sourceUrl).toBe("https://example.com/default.mp4")
  })
})
