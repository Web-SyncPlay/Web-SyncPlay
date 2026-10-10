import { describe, expect, test } from "bun:test"
import {
  getActiveRangeResponder,
  setActiveRangeResponder,
} from "./local-media-range-responder"
import {
  createLocalMediaRuntime,
  selectConnectedViewerUserIds,
  selectLazyWebrtcInviteMediaId,
} from "./local-media-runtime"
import type { RoomState } from "@/contracts/types"

describe("createLocalMediaRuntime", () => {
  test("installs and clears the active RangeResponder on close", () => {
    setActiveRangeResponder(null)
    const runtime = createLocalMediaRuntime({
      send: () => true,
      roomId: "room-1",
      userId: "user-1",
      getRoomState: () => null,
    })
    expect(getActiveRangeResponder()).toBe(runtime.rangeResponder)
    runtime.close()
    expect(getActiveRangeResponder()).toBeNull()
  })

  test("closing one runtime does not clear another tab's active responder", () => {
    setActiveRangeResponder(null)
    const first = createLocalMediaRuntime({
      send: () => true,
      roomId: "room-1",
      userId: "user-1",
      getRoomState: () => null,
    })
    const second = createLocalMediaRuntime({
      send: () => true,
      roomId: "room-2",
      userId: "user-2",
      getRoomState: () => null,
    })
    expect(getActiveRangeResponder()).toBe(second.rangeResponder)
    first.close()
    expect(getActiveRangeResponder()).toBe(second.rangeResponder)
    second.close()
    expect(getActiveRangeResponder()).toBeNull()
  })
})

describe("selectLazyWebrtcInviteMediaId", () => {
  test("returns only the current playlist localMediaId when held", () => {
    const mediaCurrent = "media-current"
    const mediaOther = "media-other"
    const roomState = {
      playlist: [
        { id: "item-1", localMediaId: mediaCurrent },
        { id: "item-2", localMediaId: mediaOther },
      ],
      currentIndex: 0,
      playback: { mediaId: "item-1" },
    } as Pick<RoomState, "playlist" | "currentIndex" | "playback">

    expect(
      selectLazyWebrtcInviteMediaId({
        roomState,
        heldLocalMediaIds: [mediaCurrent, mediaOther],
      }),
    ).toBe(mediaCurrent)

    expect(
      selectLazyWebrtcInviteMediaId({
        roomState,
        heldLocalMediaIds: [mediaOther],
      }),
    ).toBeNull()
  })
})

describe("selectConnectedViewerUserIds", () => {
  test("skips self and disconnected participants", () => {
    expect(
      selectConnectedViewerUserIds({
        selfUserId: "user-1",
        participants: {
          "user-1": { userId: "user-1", connected: true },
          "user-2": { userId: "user-2", connected: true },
          "user-3": { userId: "user-3", connected: false },
        } as unknown as RoomState["participants"],
      }),
    ).toEqual(["user-2"])
  })
})
