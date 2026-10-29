import { describe, expect, mock, test } from "bun:test"

import { createDurationChangeHandler } from "./create-duration-change-handler"

function createHandler(config?: {
  catalogDurationSeconds?: number
  seekableEndSec?: number
}) {
  let mediaDurationMs = 0
  const send = mock((type: string, payload: unknown) => {
    void type
    void payload
  })
  const enforceServerPlaybackState = mock(() => {})
  const reportedDurationItemIdRef = { current: null as string | null }
  const mediaEl = {
    seekable: {
      length: 1,
      end: () => config?.seekableEndSec ?? 5.01,
    },
  }
  const playerRef = {
    current: {
      el: {
        querySelector: (sel: string) =>
          sel.includes("video") || sel.includes("audio") ? mediaEl : null,
      },
    },
  }

  const handlers = createDurationChangeHandler({
    current: {
      id: "item-1",
      name: "clip",
      url: "https://example.com/a.m3u8",
      isLive: false,
      durationSeconds: config?.catalogDurationSeconds,
    } as never,
    activePlaybackSrc: "https://example.com/a.m3u8",
    enforceServerPlaybackState,
    send: send as never,
    reportedDurationItemIdRef,
    setMediaDurationMs: (value) => {
      mediaDurationMs =
        typeof value === "function" ? value(mediaDurationMs) : value
    },
    playerRef: playerRef as never,
  })

  return {
    handlers,
    send,
    getMediaDurationMs: () => mediaDurationMs,
    reportedDurationItemIdRef,
  }
}

describe("createDurationChangeHandler", () => {
  test("rejects buffer-sized first samples for catalog and UI duration", () => {
    const { handlers, send, getMediaDurationMs, reportedDurationItemIdRef } =
      createHandler({ seekableEndSec: 5.01 })

    handlers.onDurationChange(5.05)

    expect(getMediaDurationMs()).toBe(0)
    expect(send).not.toHaveBeenCalled()
    expect(reportedDurationItemIdRef.current).toBeNull()
  })

  test("allows upward mediaDurationMs revision and catalog publish", () => {
    const { handlers, send, getMediaDurationMs } = createHandler({
      seekableEndSec: 5.01,
    })

    handlers.onDurationChange(5.05)
    expect(getMediaDurationMs()).toBe(0)

    handlers.onDurationChange(180)
    expect(getMediaDurationMs()).toBe(180_000)
    expect(send).toHaveBeenCalledWith("playlist:item:duration", {
      itemId: "item-1",
      durationSeconds: 180,
    })
  })

  test("does not shrink mediaDurationMs toward a buffer-sized blip", () => {
    const { handlers, getMediaDurationMs, send } = createHandler({
      seekableEndSec: 5.01,
    })

    handlers.onDurationChange(180)
    expect(getMediaDurationMs()).toBe(180_000)

    handlers.onDurationChange(5.05)
    expect(getMediaDurationMs()).toBe(180_000)
    // Catalog already reported on the trusted sample.
    expect(send).toHaveBeenCalledTimes(1)
  })

  test("skips catalog overwrite when playlist already has a duration", () => {
    const { handlers, send, getMediaDurationMs } = createHandler({
      catalogDurationSeconds: 600,
      seekableEndSec: 12,
    })

    handlers.onDurationChange(180)
    expect(getMediaDurationMs()).toBe(180_000)
    expect(send).not.toHaveBeenCalled()
  })

  test("trusts fully seekable long VOD duration === seekableEnd", () => {
    const { handlers, send, getMediaDurationMs } = createHandler({
      seekableEndSec: 180,
    })

    handlers.onDurationChange(180)
    expect(getMediaDurationMs()).toBe(180_000)
    expect(send).toHaveBeenCalledWith("playlist:item:duration", {
      itemId: "item-1",
      durationSeconds: 180,
    })
  })
})
