import { describe, expect, test } from "bun:test"
import {
  getActionLogDetails,
  getFilteredLogs,
  visibleActionTypes,
} from "./log-format"
import type { ActionLogEntry } from "@/contracts/types"

function entry(
  partial: Partial<ActionLogEntry> & Pick<ActionLogEntry, "action">,
): ActionLogEntry {
  return {
    id: partial.id ?? "1",
    at: partial.at ?? 1,
    roomId: partial.roomId ?? "room-1",
    actorUserId: partial.actorUserId ?? "u1",
    actorUsername: partial.actorUsername,
    action: partial.action,
    payload: partial.payload ?? {},
    error: partial.error,
  }
}

describe("log-format", () => {
  test("formats seek and playlist details", () => {
    expect(
      getActionLogDetails(
        entry({
          action: "playback:seek",
          payload: { fromMs: 5_000, toMs: 12_000 },
        }),
      ),
    ).toBe("Seeked from 0:05 to 0:12")

    expect(
      getActionLogDetails(
        entry({
          action: "playlist:add",
          payload: { itemName: "Clip" },
        }),
      ),
    ).toBe('Added "Clip" to playlist')
  })

  test("filters to visible actions and selected actor", () => {
    const logs = [
      entry({ id: "a", action: "playback:pause", actorUserId: "u1" }),
      entry({ id: "b", action: "room:password:set", actorUserId: "u1" }),
      entry({ id: "c", action: "playback:pause", actorUserId: "u2" }),
    ]
    expect(
      getFilteredLogs({
        actionLog: logs,
        actionFilter: "all",
        userFilter: "u1",
      }).map((log) => log.id),
    ).toEqual(["a"])
    expect(visibleActionTypes).not.toContain("room:password:set")
  })
})
