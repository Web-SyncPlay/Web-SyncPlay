import { describe, expect, test } from "bun:test"
import {
  resolveCurrentPlaylistItem,
  resolveCurrentPlaylistItemId,
} from "@/shared/playlist-current"
import { createRoomState } from "@/shared/test-utils/room-fixtures"

describe("playlist-current", () => {
  test("prefers playback.mediaId over currentIndex", () => {
    const state = createRoomState({
      currentIndex: 0,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    expect(resolveCurrentPlaylistItem(state)?.id).toBe("item-b")
    expect(resolveCurrentPlaylistItemId(state)).toBe("item-b")
  })

  test("falls back to currentIndex when mediaId is missing", () => {
    const state = createRoomState({ currentIndex: 2 })
    expect(resolveCurrentPlaylistItem(state)?.id).toBe("item-c")
    expect(resolveCurrentPlaylistItemId(state)).toBe("item-c")
  })

  test("falls back to currentIndex when mediaId is not in playlist", () => {
    const state = createRoomState({
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "gone",
      },
    })
    expect(resolveCurrentPlaylistItem(state)?.id).toBe("item-b")
  })
})
