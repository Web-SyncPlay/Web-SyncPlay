import { describe, expect, test } from "bun:test"
import {
  applyResolvedMediaToItem,
} from "@/server/realtime/services/playlist-resolve"
import type { ResolvedMedia } from "@/server/media/resolve"
import { createPlaylistItem } from "@/server/realtime/test-utils/fixtures"

describe("playlist resolve helpers", () => {
  test("applyResolvedMediaToItem fills catalog fields and clears deprecated aliases", () => {
    const item = createPlaylistItem({
      id: "item-1",
      name: "https://example.com/a",
      sourceUrl: "https://example.com/a",
      selectedStreamId: "old",
      selectedTextTrackId: "old-track",
      ingestStatus: "resolving",
    })

    const resolved = {
      playableUrl: "https://cdn.example/a.mp4",
      sourceUrl: "https://example.com/a",
      playbackMode: "direct" as const,
      mediaStreams: [
        { id: "s1", src: "https://cdn.example/a.mp4", isDefault: true },
      ],
      defaultStreamId: "s1",
      textTracks: [],
      defaultTextTrackId: undefined,
      durationSeconds: 12,
      isLive: false,
      title: "Nice title",
    } satisfies ResolvedMedia

    applyResolvedMediaToItem(item, resolved)

    expect(item.ingestStatus).toBe("ready")
    expect(item.playableUrl).toBe("https://cdn.example/a.mp4")
    expect(item.defaultStreamId).toBe("s1")
    expect(item.selectedStreamId).toBeUndefined()
    expect(item.selectedTextTrackId).toBeUndefined()
    expect(item.name).toBe("Nice title")
  })
})
