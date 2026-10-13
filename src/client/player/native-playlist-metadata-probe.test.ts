import { createPlaylistItem } from "@/shared/test-utils/room-fixtures"
import { afterEach, describe, expect, test } from "bun:test"
import {
  claimNextNativePlaylistMetadataProbe,
  isPlaylistItemNamePlaceholder,
  playlistItemNeedsNativeMetadata,
  queueNativePlaylistMetadataProbe,
  releaseNativePlaylistMetadataProbe,
  resetNativePlaylistMetadataProbeStateForTests,
  wasNativePlaylistItemProbed,
} from "./native-playlist-metadata-probe"

afterEach(() => {
  resetNativePlaylistMetadataProbeStateForTests()
})

describe("native playlist metadata probe helpers", () => {
  test("isPlaylistItemNamePlaceholder compares trimmed name to sourceUrl", () => {
    expect(
      isPlaylistItemNamePlaceholder({
        name: "https://youtu.be/abc",
        sourceUrl: "https://youtu.be/abc",
      }),
    ).toBe(true)
    expect(
      isPlaylistItemNamePlaceholder({
        name: "  https://youtu.be/abc  ",
        sourceUrl: "https://youtu.be/abc",
      }),
    ).toBe(true)
    expect(
      isPlaylistItemNamePlaceholder({
        name: "Cool Video",
        sourceUrl: "https://youtu.be/abc",
      }),
    ).toBe(false)
  })

  test("playlistItemNeedsNativeMetadata only for native providers", () => {
    expect(
      playlistItemNeedsNativeMetadata({
        sourceUrl: "https://cdn.example.com/a.mp4",
        name: "https://cdn.example.com/a.mp4",
      }),
    ).toEqual({ needsTitle: false, needsDuration: false })

    expect(
      playlistItemNeedsNativeMetadata({
        sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        name: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      }),
    ).toEqual({ needsTitle: true, needsDuration: true })

    expect(
      playlistItemNeedsNativeMetadata({
        sourceUrl: "https://vimeo.com/123",
        name: "My Clip",
        durationSeconds: 40,
      }),
    ).toEqual({ needsTitle: false, needsDuration: false })

    expect(
      playlistItemNeedsNativeMetadata({
        sourceUrl: "https://vimeo.com/123",
        name: "https://vimeo.com/123",
        isLive: true,
      }),
    ).toEqual({ needsTitle: true, needsDuration: false })
  })

  test("queue ignores non-native URLs", () => {
    expect(queueNativePlaylistMetadataProbe("https://example.com/a.mp4")).toBe(
      false,
    )
    expect(queueNativePlaylistMetadataProbe("https://youtu.be/abc123")).toBe(
      true,
    )
  })

  test("claim matches newest item by createdBy + sourceUrl and dedupes", () => {
    const url = "https://youtu.be/abc123"
    queueNativePlaylistMetadataProbe(url)

    const older = createPlaylistItem({
      id: "old",
      name: url,
      sourceUrl: url,
      createdBy: "user-1",
      createdAt: 1,
    })
    const newer = createPlaylistItem({
      id: "new",
      name: url,
      sourceUrl: url,
      createdBy: "user-1",
      createdAt: 2,
    })
    const otherUser = createPlaylistItem({
      id: "other",
      name: url,
      sourceUrl: url,
      createdBy: "user-2",
      createdAt: 3,
    })

    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [older, newer, otherUser],
        userId: "user-1",
      })?.item.id,
    ).toBe("new")
    expect(wasNativePlaylistItemProbed("new")).toBe(true)

    // Pending consumed; no second claim for the same queue entry.
    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [older, newer, otherUser],
        userId: "user-1",
      }),
    ).toBeNull()

    // Re-queue still skips already-probed newest; falls through to older.
    queueNativePlaylistMetadataProbe(url)
    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [older, newer, otherUser],
        userId: "user-1",
      })?.item.id,
    ).toBe("old")
  })

  test("claim waits when item not in playlist yet", () => {
    const url = "https://www.youtube.com/watch?v=zzzz"
    queueNativePlaylistMetadataProbe(url)
    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [],
        userId: "user-1",
      }),
    ).toBeNull()

    const item = createPlaylistItem({
      id: "item-1",
      name: url,
      sourceUrl: url,
      createdBy: "user-1",
    })
    const claimed = claimNextNativePlaylistMetadataProbe({
      playlist: [item],
      userId: "user-1",
    })
    expect(claimed?.item.id).toBe("item-1")
    expect(claimed?.needsTitle).toBe(true)
    expect(claimed?.needsDuration).toBe(true)
  })

  test("release re-queues incomplete probes and keeps completed marked", () => {
    const url = "https://youtu.be/release-me"
    queueNativePlaylistMetadataProbe(url)
    const item = createPlaylistItem({
      id: "item-r",
      name: url,
      sourceUrl: url,
      createdBy: "user-1",
    })
    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [item],
        userId: "user-1",
      })?.item.id,
    ).toBe("item-r")

    releaseNativePlaylistMetadataProbe({
      itemId: "item-r",
      sourceUrl: url,
      completed: false,
    })
    expect(wasNativePlaylistItemProbed("item-r")).toBe(false)

    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [item],
        userId: "user-1",
      })?.item.id,
    ).toBe("item-r")

    releaseNativePlaylistMetadataProbe({
      itemId: "item-r",
      sourceUrl: url,
      completed: true,
    })
    expect(wasNativePlaylistItemProbed("item-r")).toBe(true)
    expect(
      claimNextNativePlaylistMetadataProbe({
        playlist: [item],
        userId: "user-1",
      }),
    ).toBeNull()
  })
})
