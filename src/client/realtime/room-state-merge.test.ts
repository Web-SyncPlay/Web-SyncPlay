import { describe, expect, test } from "bun:test"
import {
  applyPresenceBatch,
  applyPresenceBatches,
  applyRoomControl,
  applyRoomSnapshot,
  createPresenceBatchCoalescer,
} from "@/client/realtime/room-state-merge"
import { createRoomState } from "@/shared/test-utils/room-fixtures"
import type { PresenceBatchPayload } from "@/contracts/types"

describe("room-state-merge", () => {
  test("control ignores older generation", () => {
    const prev = createRoomState({ generation: 5 })
    const next = applyRoomControl(prev, {
      generation: 4,
      currentIndex: 2,
      updatedAt: Date.now(),
      playback: { ...prev.playback, paused: false },
    })
    expect(next?.generation).toBe(5)
    expect(next?.currentIndex).toBe(0)
  })

  test("presence merge reuses playlist reference", () => {
    const prev = createRoomState()
    const next = applyPresenceBatch(prev, {
      presenceRevision: 1,
      serverNowMs: Date.now(),
      participants: {
        guest: {
          localPlayback: {
            paused: false,
            currentTimeMs: 999,
            loading: false,
            updatedAt: Date.now(),
          },
        },
      },
    })
    expect(next?.playlist).toBe(prev.playlist)
    expect(next?.participants.guest?.localPlayback.currentTimeMs).toBe(999)
  })

  test("presence merge preserves identity fields when patch omits them", () => {
    const prev = createRoomState()
    const next = applyPresenceBatch(prev, {
      presenceRevision: 1,
      serverNowMs: Date.now(),
      participants: {
        guest: {
          connected: false,
          lastSeenAt: 42,
        },
      },
    })
    expect(next?.participants.guest?.username).toBe(
      prev.participants.guest?.username,
    )
    expect(next?.participants.guest?.avatarStyle).toBe(
      prev.participants.guest?.avatarStyle,
    )
    expect(next?.participants.guest?.connected).toBe(false)
    expect(next?.participants.guest?.lastSeenAt).toBe(42)
  })

  test("late snapshot does not rewind newer control playback", () => {
    const base = createRoomState({ generation: 1 })
    const afterControl = applyRoomControl(base, {
      generation: 3,
      currentIndex: 1,
      updatedAt: Date.now(),
      playback: {
        ...base.playback,
        timelineAnchorMs: 50_000,
        paused: false,
      },
    })!
    const afterSnapshot = applyRoomSnapshot(afterControl, {
      ...base,
      generation: 2,
      structuralRevision: 2,
      currentIndex: 0,
      playback: {
        ...base.playback,
        timelineAnchorMs: 0,
        paused: true,
      },
    })
    expect(afterSnapshot.playback.timelineAnchorMs).toBe(50_000)
    expect(afterSnapshot.currentIndex).toBe(1)
    expect(afterSnapshot.generation).toBe(3)
  })

  test("control remaps decremented index via mediaId when playlist is stale", () => {
    // Playing B at index 1; server removed A and sent control with index 0
    // before the snapshot updates the playlist.
    const prev = createRoomState({
      generation: 1,
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 0,
      updatedAt: Date.now(),
      playback: {
        ...prev.playback,
        mediaId: "item-b",
      },
    })
    expect(next?.currentIndex).toBe(1)
    expect(next?.playlist[next.currentIndex]?.id).toBe("item-b")
    expect(next?.playback.mediaId).toBe("item-b")
  })

  test("control resolves delete-current mediaId against stale playlist", () => {
    // Playing B at index 1; server removed B, advanced to C (mediaId), and
    // sent control before the snapshot drops B from the playlist.
    const prev = createRoomState({
      generation: 1,
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 1,
      updatedAt: Date.now(),
      playback: {
        ...prev.playback,
        mediaId: "item-c",
        timelineAnchorMs: 0,
      },
    })
    expect(next?.currentIndex).toBe(2)
    expect(next?.playlist[next.currentIndex]?.id).toBe("item-c")
    expect(next?.playback.mediaId).toBe("item-c")
  })

  test("control keeps previous index when mediaId is absent from playlist", () => {
    const prev = createRoomState({
      generation: 1,
      currentIndex: 1,
      playback: {
        ...createRoomState().playback,
        mediaId: "item-b",
      },
    })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 0,
      updatedAt: Date.now(),
      playback: {
        ...prev.playback,
        mediaId: "missing-item",
      },
    })
    expect(next?.currentIndex).toBe(1)
    expect(next?.playback.mediaId).toBe("missing-item")
  })

  test("applyPresenceBatches folds envelopes in order", () => {
    const prev = createRoomState()
    const next = applyPresenceBatches(prev, [
      {
        presenceRevision: 1,
        serverNowMs: 1,
        participants: {
          guest: { lastSeenAt: 10, connected: true },
        },
      },
      {
        presenceRevision: 2,
        serverNowMs: 2,
        participants: {
          guest: {
            localPlayback: {
              paused: false,
              currentTimeMs: 500,
              loading: false,
              updatedAt: 2,
            },
          },
        },
      },
    ])
    expect(next?.participants.guest?.lastSeenAt).toBe(10)
    expect(next?.participants.guest?.localPlayback.currentTimeMs).toBe(500)
    expect(next?.presenceRevision).toBe(2)
    expect(next?.playlist).toBe(prev.playlist)
  })

  test("presence ignores older or equal revision", () => {
    const prev = createRoomState({ presenceRevision: 3 })
    const older = applyPresenceBatch(prev, {
      presenceRevision: 2,
      serverNowMs: 2,
      participants: {
        guest: { lastSeenAt: 999, connected: false },
      },
    })
    expect(older).toBe(prev)
    expect(older?.participants.guest?.lastSeenAt).toBe(
      prev.participants.guest?.lastSeenAt,
    )

    const equal = applyPresenceBatch(prev, {
      presenceRevision: 3,
      serverNowMs: 3,
      participants: {
        guest: { lastSeenAt: 888, connected: false },
      },
    })
    expect(equal).toBe(prev)
  })

  test("presence applies newer revision and advances watermark", () => {
    const prev = createRoomState({ presenceRevision: 1 })
    const next = applyPresenceBatch(prev, {
      presenceRevision: 4,
      serverNowMs: 4,
      participants: {
        guest: { lastSeenAt: 42 },
      },
    })
    expect(next).not.toBe(prev)
    expect(next?.presenceRevision).toBe(4)
    expect(next?.participants.guest?.lastSeenAt).toBe(42)
  })

  test("out-of-order presence batches keep newer revision", () => {
    const prev = createRoomState()
    const next = applyPresenceBatches(prev, [
      {
        presenceRevision: 5,
        serverNowMs: 5,
        participants: {
          guest: { lastSeenAt: 50, connected: true },
        },
      },
      {
        presenceRevision: 3,
        serverNowMs: 3,
        participants: {
          guest: { lastSeenAt: 30, connected: false },
        },
      },
    ])
    expect(next?.presenceRevision).toBe(5)
    expect(next?.participants.guest?.lastSeenAt).toBe(50)
    expect(next?.participants.guest?.connected).toBe(true)
  })

  test("snapshot preserves presenceRevision watermark", () => {
    const prev = createRoomState({ presenceRevision: 7, generation: 2 })
    const next = applyRoomSnapshot(prev, {
      ...prev,
      presenceRevision: undefined,
      generation: 3,
      structuralRevision: 1,
    })
    expect(next.presenceRevision).toBe(7)
    expect(next.generation).toBe(3)
  })

  test("snapshot adopts server presenceRevision after reconnect watermark reset", () => {
    const prev = createRoomState({ presenceRevision: 0, generation: 2 })
    const next = applyRoomSnapshot(prev, {
      ...prev,
      presenceRevision: 42,
      generation: 3,
      structuralRevision: 1,
    })
    expect(next.presenceRevision).toBe(42)
  })

  test("presence coalescer flushes many enqueues once per schedule turn", () => {
    const flushes: PresenceBatchPayload[][] = []
    let scheduledFlush: (() => void) | null = null
    let scheduleCalls = 0

    const coalescer = createPresenceBatchCoalescer({
      onFlush: (payloads) => {
        flushes.push(payloads)
      },
      schedule: (flush) => {
        scheduleCalls += 1
        scheduledFlush = flush
        return () => {
          if (scheduledFlush === flush) scheduledFlush = null
        }
      },
    })

    const a: PresenceBatchPayload = {
      presenceRevision: 1,
      serverNowMs: 1,
      participants: { guest: { lastSeenAt: 1 } },
    }
    const b: PresenceBatchPayload = {
      presenceRevision: 2,
      serverNowMs: 2,
      participants: { guest: { lastSeenAt: 2 } },
    }
    const c: PresenceBatchPayload = {
      presenceRevision: 3,
      serverNowMs: 3,
      participants: { host: { connected: false } },
    }

    coalescer.enqueue(a)
    coalescer.enqueue(b)
    coalescer.enqueue(c)
    expect(scheduleCalls).toBe(1)
    expect(coalescer.pendingCount()).toBe(3)
    expect(flushes).toEqual([])

    expect(scheduledFlush).not.toBeNull()
    scheduledFlush!()
    expect(flushes).toEqual([[a, b, c]])
    expect(coalescer.pendingCount()).toBe(0)

    coalescer.enqueue(a)
    expect(scheduleCalls).toBe(2)
    expect(scheduledFlush).not.toBeNull()
    scheduledFlush!()
    expect(flushes).toEqual([[a, b, c], [a]])
  })

  test("presence coalescer dispose drops pending without flushing", () => {
    const flushes: PresenceBatchPayload[][] = []
    let scheduledFlush: (() => void) | null = null
    let cancelled = false

    const coalescer = createPresenceBatchCoalescer({
      onFlush: (payloads) => {
        flushes.push(payloads)
      },
      schedule: (flush) => {
        scheduledFlush = flush
        return () => {
          cancelled = true
          scheduledFlush = null
        }
      },
    })

    coalescer.enqueue({
      presenceRevision: 1,
      serverNowMs: 1,
      participants: { guest: { lastSeenAt: 1 } },
    })
    expect(coalescer.pendingCount()).toBe(1)
    coalescer.dispose()
    expect(cancelled).toBe(true)
    expect(coalescer.pendingCount()).toBe(0)
    expect(flushes).toEqual([])
    expect(scheduledFlush).toBeNull()
  })

  test("control merge stays sync while presence remains queued", () => {
    // Mirrors use-room-socket: room:control applies immediately; presence:batch
    // only flushes when the coalescer schedule runs.
    let flushCount = 0
    const coalescer = createPresenceBatchCoalescer({
      onFlush: () => {
        flushCount += 1
      },
      schedule: () => () => {},
    })

    coalescer.enqueue({
      presenceRevision: 1,
      serverNowMs: 1,
      participants: { guest: { lastSeenAt: 1 } },
    })
    expect(coalescer.pendingCount()).toBe(1)
    expect(flushCount).toBe(0)

    const prev = createRoomState({ generation: 1 })
    const next = applyRoomControl(prev, {
      generation: 2,
      currentIndex: 0,
      updatedAt: Date.now(),
      playback: { ...prev.playback, paused: false },
    })
    expect(next?.generation).toBe(2)
    expect(next?.playback.paused).toBe(false)
    expect(flushCount).toBe(0)
    expect(coalescer.pendingCount()).toBe(1)
  })
})
