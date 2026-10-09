import { describe, expect, test } from "bun:test"
import {
  applyPlaylistItemDuration,
  applyPlaylistItemError,
  applyPlaylistRemove,
  applyPlaylistRename,
  applyPlaylistReorder,
  applyPlaylistSelect,
  buildLocalFilePlaylistItem,
  buildRemoteUrlPlaylistItem,
  canRetryRemotePlaylistItem,
  isPlaylistAtLimit,
} from "./playlist-ops"
import {
  createPlaylistItem,
  createRoomState,
} from "@/server/realtime/test-utils/fixtures"

describe("playlist-ops", () => {
  test("applyPlaylistSelect rejects OOB and resets timeline", () => {
    const state = createRoomState({
      playback: {
        paused: false,
        playbackRate: 1,
        timelineAnchorMs: 9_000,
        serverNowMs: 1_000,
        videoLoop: "off",
        playlistLoop: "off",
      },
    })
    expect(applyPlaylistSelect(state, -1)).toBe(false)
    expect(state.currentIndex).toBe(0)
    expect(state.playback.timelineAnchorMs).toBe(9_000)

    expect(applyPlaylistSelect(state, 2)).toBe(true)
    expect(state.currentIndex).toBe(2)
    expect(state.playback.timelineAnchorMs).toBe(0)
    expect(state.playback.paused).toBe(false)
  })

  test("applyPlaylistReorder keeps current media identity", () => {
    const state = createRoomState({ currentIndex: 1 })
    const beforeId = state.playlist[1]?.id
    const moved = applyPlaylistReorder(state, 0, 2)
    expect(moved?.id).toBe("item-a")
    expect(state.playlist.map((item) => item.id)).toEqual([
      "item-b",
      "item-c",
      "item-a",
    ])
    expect(state.playlist[state.currentIndex]?.id).toBe(beforeId)
    expect(applyPlaylistReorder(state, -1, 0)).toBeNull()
  })

  test("applyPlaylistRemove adjusts current index", () => {
    const state = createRoomState({ currentIndex: 1 })
    const result = applyPlaylistRemove(state, "item-b")
    expect(result?.removed.id).toBe("item-b")
    expect(state.playlist.map((item) => item.id)).toEqual([
      "item-a",
      "item-c",
    ])
    expect(state.currentIndex).toBe(1)

    const empty = createRoomState({
      playlist: [createPlaylistItem({ id: "only", name: "Only" })],
      currentIndex: 0,
    })
    empty.playback.timelineAnchorMs = 4_000
    applyPlaylistRemove(empty, "only")
    expect(empty.playlist).toHaveLength(0)
    expect(empty.currentIndex).toBe(0)
    expect(empty.playback.paused).toBe(true)
    expect(empty.playback.timelineAnchorMs).toBe(0)
  })

  test("applyPlaylistRemove prunes viewerMedia.byItemId for all participants", () => {
    const state = createRoomState({ currentIndex: 0 })
    state.participants.owner!.viewerMedia = {
      byItemId: {
        "item-b": { streamId: "stream-1" },
        "item-c": { streamId: "stream-1" },
      },
    }
    state.participants.guest!.viewerMedia = {
      byItemId: {
        "item-b": { textTrackId: "track-1" },
      },
    }
    state.participants.mod!.viewerMedia = {
      byItemId: {
        "item-a": { streamId: "stream-1" },
      },
    }

    applyPlaylistRemove(state, "item-b")

    expect(state.participants.owner?.viewerMedia?.byItemId).toEqual({
      "item-c": { streamId: "stream-1" },
    })
    expect(state.participants.guest?.viewerMedia).toBeUndefined()
    expect(state.participants.mod?.viewerMedia?.byItemId).toEqual({
      "item-a": { streamId: "stream-1" },
    })
  })

  test("applyPlaylistRename rejects empty/same and updates when valid", () => {
    const state = createRoomState()
    expect(applyPlaylistRename(state, "item-a", "A")).toBeNull()
    expect(applyPlaylistRename(state, "missing", "X")).toBeNull()
    const renamed = applyPlaylistRename(state, "item-a", " Alpha ")
    expect(renamed?.nextName).toBe("Alpha")
    expect(state.playlist[0]?.name).toBe("Alpha")
  })

  test("applyPlaylistItemError advances and can clear", () => {
    const state = createRoomState({ currentIndex: 0 })
    const errored = applyPlaylistItemError(state, "item-a", "decode failed")
    expect(errored?.cleared).toBe(false)
    expect(state.playlist[0]?.ingestStatus).toBe("error")
    expect(state.currentIndex).toBe(1)
    expect(state.playback.paused).toBe(true)

    const cleared = applyPlaylistItemError(state, "item-a", null)
    expect(cleared?.cleared).toBe(true)
    expect(state.playlist[0]?.ingestStatus).toBe("ready")
    expect(state.playlist[0]?.ingestError).toBeUndefined()
  })

  test("canRetryRemotePlaylistItem gates local and blocked items", () => {
    expect(
      canRetryRemotePlaylistItem(
        createPlaylistItem({
          id: "r",
          name: "R",
          sourceKind: "remote_url",
        }),
      ),
    ).toBe(true)
    expect(
      canRetryRemotePlaylistItem(
        createPlaylistItem({
          id: "l",
          name: "L",
          sourceKind: "local_file",
        }),
      ),
    ).toBe(false)
    expect(
      canRetryRemotePlaylistItem(
        createPlaylistItem({
          id: "b",
          name: "B",
          sourceKind: "remote_url",
          blockedReason: "local_owner_offline",
        }),
      ),
    ).toBe(false)
  })

  test("builders and limit helper", () => {
    const remote = buildRemoteUrlPlaylistItem({
      id: "r1",
      sourceUrl: "https://example.com/a",
      createdBy: "u1",
    })
    expect(remote.ingestStatus).toBe("resolving")
    expect(remote.sourceKind).toBe("remote_url")

    const local = buildLocalFilePlaylistItem({
      id: "l1",
      name: "clip.mp4",
      localMediaId: "m1",
      mimeType: "video/mp4",
      sizeBytes: 10,
      createdBy: "u1",
      durationSeconds: 42.6,
    })
    expect(local.playableUrl).toBe("/api/media/local/m1")
    expect(local.defaultStreamId).toBe("local-default")
    expect(local.durationSeconds).toBe(43)

    const state = createRoomState()
    expect(isPlaylistAtLimit(state, 3)).toBe(true)
    expect(isPlaylistAtLimit(state, 10)).toBe(false)
  })

  test("applyPlaylistItemDuration fills once and ignores live/invalid", () => {
    const state = createRoomState()
    const item = state.playlist[0]
    expect(item?.durationSeconds).toBeUndefined()

    expect(applyPlaylistItemDuration(state, "item-a", 125.4)?.durationSeconds).toBe(
      125,
    )
    expect(state.playlist[0]?.durationSeconds).toBe(125)

    // First finite value wins.
    expect(applyPlaylistItemDuration(state, "item-a", 200)).toBeNull()
    expect(state.playlist[0]?.durationSeconds).toBe(125)

    expect(applyPlaylistItemDuration(state, "missing", 10)).toBeNull()
    expect(applyPlaylistItemDuration(state, "item-a", 0)).toBeNull()

    state.playlist[1]!.isLive = true
    expect(applyPlaylistItemDuration(state, "item-b", 90)).toBeNull()
  })
})
