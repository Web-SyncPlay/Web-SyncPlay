import { describe, expect, test } from "bun:test"
import { appendActionLog, pruneActionLog } from "@/server/log"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"
import { roomActionLogMaxAgeMs } from "@/contracts/types"

describe("action log TTL", () => {
  test("pruneActionLog drops entries older than room TTL", () => {
    const now = Date.now()
    const kept = {
      id: "new",
      at: now - 1_000,
      roomId: "room-1",
      actorUserId: "u1",
      action: "playback:seek",
      payload: {},
    }
    const stale = {
      id: "old",
      at: now - roomActionLogMaxAgeMs - 1,
      roomId: "room-1",
      actorUserId: "u1",
      action: "playback:seek",
      payload: {},
    }

    expect(pruneActionLog([stale, kept], now)).toEqual([kept])
  })

  test("appendActionLog prunes stale entries on write", () => {
    const now = Date.now()
    const state = createRoomState({
      actionLog: [
        {
          id: "old",
          at: now - roomActionLogMaxAgeMs - 5_000,
          roomId: "room-1",
          actorUserId: "u1",
          action: "playback:pause",
          payload: {},
        },
      ],
    })

    appendActionLog(state, {
      roomId: "room-1",
      actorUserId: "u1",
      action: "playback:unpause",
      payload: {},
      at: now,
    })

    expect(state.actionLog).toHaveLength(1)
    expect(state.actionLog[0]?.action).toBe("playback:unpause")
  })
})
