import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { PlaylistItem } from "@/zod/types"

const toastError = mock((_message: string) => {})

mock.module("sonner", () => ({
  toast: { error: toastError },
}))

const { createPlaybackErrorHandler } = await import(
  "./create-playback-error-handler"
)

function createDeps(overrides: {
  current?: PlaylistItem | null
  activePlaybackSrc?: string
  canControlPlayback?: boolean
  userId?: string
  reportedItemErrorRef?: { current: string | null }
  proxyRenewAttemptedRef?: { current: string | null }
  localBlobFallbackAttemptedRef?: { current: string | null }
} = {}) {
  const sent: Array<{ type: string; payload: unknown }> = []
  const setIsBuffering = mock((_v: boolean) => {})
  const setPlaybackError = mock((_v: unknown) => {})
  const setForceLocalRelaySrc = mock((_v: boolean) => {})
  const setPlayerRemountNonce = mock((fn: (n: number) => number) => fn(2))
  const bufferingSinceRef = { current: 100 as number | null }
  const participantStatusErrorRef = { current: "old" as string | null }

  const current =
    overrides.current ??
    ({
      id: "item-1",
      name: "Remote",
      sourceKind: "remote_url",
      playbackMode: "direct",
      sourceUrl: "https://example.com/a.mp4",
      playableUrl: "/api/media/proxy/abc",
      createdBy: "owner",
      createdAt: 1,
    } satisfies PlaylistItem)

  const handler = createPlaybackErrorHandler({
    current,
    playerSrc: overrides.activePlaybackSrc ?? "/api/media/proxy/abc",
    activePlaybackSrc: overrides.activePlaybackSrc ?? "/api/media/proxy/abc",
    send: ((type: string, payload: unknown) => {
      sent.push({ type, payload })
    }) as never,
    canControlPlayback: overrides.canControlPlayback ?? true,
    userId: overrides.userId ?? "owner",
    bufferingSinceRef,
    participantStatusErrorRef,
    reportedItemErrorRef: overrides.reportedItemErrorRef ?? { current: null },
    proxyRenewAttemptedRef:
      overrides.proxyRenewAttemptedRef ?? { current: null },
    localBlobFallbackAttemptedRef:
      overrides.localBlobFallbackAttemptedRef ?? { current: null },
    setIsBuffering,
    setPlaybackError,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
  })

  return {
    onError: handler.onError,
    sent,
    setIsBuffering,
    setPlaybackError,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
    bufferingSinceRef,
    participantStatusErrorRef,
  }
}

describe("createPlaybackErrorHandler", () => {
  beforeEach(() => {
    toastError.mockClear()
  })

  test("clears buffering markers then records the error", () => {
    const deps = createDeps()
    const detail = { code: 4, message: "decode failed" } as never
    deps.onError(detail)

    expect(deps.setIsBuffering).toHaveBeenCalledWith(false)
    expect(deps.bufferingSinceRef.current).toBeNull()
    expect(deps.participantStatusErrorRef.current).toBeNull()
    expect(deps.setPlaybackError).toHaveBeenCalledWith(detail)
  })

  test("host local blob failure falls back to relay once", () => {
    const localBlobFallbackAttemptedRef = { current: null as string | null }
    const deps = createDeps({
      userId: "host-1",
      activePlaybackSrc: "blob:https://app/1",
      localBlobFallbackAttemptedRef,
      current: {
        id: "local-1",
        name: "Local",
        sourceKind: "local_file",
        playbackMode: "direct",
        sourceUrl: "blob:https://app/1",
        playableUrl: "blob:https://app/1",
        localMediaId: "00000000-0000-4000-8000-000000000001",
        localOriginUserId: "host-1",
        createdBy: "host-1",
        createdAt: 1,
      },
    })

    deps.onError({ code: 4, message: "blob failed" } as never)
    expect(localBlobFallbackAttemptedRef.current).toBe("local-1")
    expect(deps.setForceLocalRelaySrc).toHaveBeenCalledWith(true)
    expect(deps.setPlayerRemountNonce).toHaveBeenCalled()
    expect(deps.setPlaybackError).toHaveBeenCalledWith(undefined)
    expect(deps.sent).toHaveLength(0)

    deps.onError({ code: 4, message: "blob failed again" } as never)
    expect(deps.sent.some((e) => e.type === "playlist:retry")).toBe(false)
  })

  test("stale proxy triggers one playlist retry for controllers", () => {
    const proxyRenewAttemptedRef = { current: null as string | null }
    const deps = createDeps({ proxyRenewAttemptedRef })
    deps.onError({ code: 4, message: "HTTP 404 not found" } as never)

    expect(proxyRenewAttemptedRef.current).toBe("item-1")
    expect(deps.sent).toEqual([
      { type: "playlist:retry", payload: { itemId: "item-1" } },
    ])
    expect(deps.setPlaybackError).toHaveBeenLastCalledWith(undefined)
    expect(toastError).not.toHaveBeenCalled()
  })

  test("reports user-facing local relay errors to the room once", () => {
    const reportedItemErrorRef = { current: null as string | null }
    const deps = createDeps({
      reportedItemErrorRef,
      current: {
        id: "local-viewer",
        name: "Local",
        sourceKind: "local_file",
        playbackMode: "direct",
        sourceUrl: "/api/media/local/00000000-0000-4000-8000-000000000001",
        playableUrl: "/api/media/local/00000000-0000-4000-8000-000000000001",
        localMediaId: "00000000-0000-4000-8000-000000000001",
        localOriginUserId: "other-host",
        createdBy: "other-host",
        createdAt: 1,
      },
      activePlaybackSrc: "/api/media/local/00000000-0000-4000-8000-000000000001",
      canControlPlayback: true,
    })

    deps.onError({ code: 4, message: "HTTP 404 not found" } as never)
    expect(reportedItemErrorRef.current).toBe("local-viewer")
    expect(toastError).toHaveBeenCalled()
    expect(deps.sent[0]?.type).toBe("playlist:item:error")
    expect(deps.sent[0]?.payload).toMatchObject({ itemId: "local-viewer" })

    deps.onError({ code: 4, message: "HTTP 404 again" } as never)
    expect(deps.sent).toHaveLength(1)
  })

  test("skips room report for guests and while resolving", () => {
    const guest = createDeps({ canControlPlayback: false })
    guest.onError({ code: 4, message: "failed" } as never)
    expect(guest.sent).toHaveLength(0)
    expect(toastError).not.toHaveBeenCalled()

    const resolving = createDeps({
      current: {
        id: "ingest",
        name: "Remote",
        sourceKind: "remote_url",
        playbackMode: "direct",
        sourceUrl: "https://example.com/a.mp4",
        playableUrl: "https://example.com/a.mp4",
        ingestStatus: "resolving",
        createdBy: "owner",
        createdAt: 1,
      },
    })
    resolving.onError({ code: 4, message: "failed" } as never)
    expect(resolving.sent).toHaveLength(0)
  })
})
