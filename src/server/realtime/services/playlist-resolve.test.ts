import { describe, expect, test } from "bun:test"
import {
  applyResolvedMediaToItem,
} from "@/server/realtime/services/playlist-resolve"
import type { ResolvedMedia } from "@/server/media/media-resolve-port"
import { createPlaylistItem } from "@/server/realtime/test-utils/fixtures"

function sampleResolved(
  overrides?: Partial<ResolvedMedia>,
): ResolvedMedia {
  return {
    playableUrl: "https://cdn.example/a.mp4",
    sourceUrl: "https://example.com/a",
    playbackMode: "direct",
    mediaStreams: [
      { id: "s1", src: "https://cdn.example/a.mp4", isDefault: true },
    ],
    defaultStreamId: "s1",
    textTracks: [],
    defaultTextTrackId: undefined,
    durationSeconds: 12,
    isLive: false,
    title: "Nice title",
    ...overrides,
  } satisfies ResolvedMedia
}

describe("playlist resolve helpers", () => {
  test("applyResolvedMediaToItem fills catalog fields", () => {
    const item = createPlaylistItem({
      id: "item-1",
      name: "https://example.com/a",
      sourceUrl: "https://example.com/a",
      ingestStatus: "resolving",
    })

    applyResolvedMediaToItem(item, sampleResolved())

    expect(item.ingestStatus).toBe("ready")
    expect(item.playableUrl).toBe("https://cdn.example/a.mp4")
    expect(item.defaultStreamId).toBe("s1")
    expect(item.defaultTextTrackId).toBeUndefined()
    expect(item.name).toBe("Nice title")
  })

  test("applyResolvedMediaToItem keeps a customized name", () => {
    const item = createPlaylistItem({
      id: "item-1",
      name: "My custom name",
      sourceUrl: "https://example.com/a",
      ingestStatus: "resolving",
    })

    applyResolvedMediaToItem(item, sampleResolved(), {
      preferredTitle: "https://example.com/a",
    })

    expect(item.name).toBe("My custom name")
  })

  test("applyResolvedMediaToItem replaces preferred placeholder title", () => {
    const item = createPlaylistItem({
      id: "item-1",
      name: "Seed title",
      sourceUrl: "https://example.com/a",
      ingestStatus: "resolving",
    })

    applyResolvedMediaToItem(item, sampleResolved(), {
      preferredTitle: "Seed title",
    })

    expect(item.name).toBe("Nice title")
  })
})
