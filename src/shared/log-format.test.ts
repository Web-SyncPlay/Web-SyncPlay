import { describe, expect, test } from "bun:test"

import type { ActionLogEntry } from "@/contracts/types"

import {
  countLogsByCategory,
  getActionCategory,
  getActionLogDetails,
  getActionLogPayloadRows,
  getFilteredLogs,
  highlightQuerySegments,
  visibleActionTypes,
} from "./log-format"

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

  test("formats owner transfer with actor username", () => {
    expect(
      getActionLogDetails(
        entry({
          action: "participant:owner:transferred",
          actorUsername: "Ada",
          payload: { nextOwnerId: "u-ada" },
        }),
      ),
    ).toBe("Ownership transferred to Ada")
  })

  test("maps actions to categories", () => {
    expect(getActionCategory("playback:seek")).toBe("playback")
    expect(getActionCategory("playlist:add")).toBe("playlist")
    expect(getActionCategory("participant:joined")).toBe("presence")
    expect(getActionCategory("participant:error")).toBe("error")
    expect(getActionCategory("media:played")).toBe("playback")
  })

  test("filters to visible actions and selected actor (legacy)", () => {
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

  test("filters by category, multi-user, query, and time range", () => {
    const logs = [
      entry({
        id: "a",
        action: "playback:pause",
        actorUserId: "u1",
        actorUsername: "Ada",
        at: 100,
      }),
      entry({
        id: "b",
        action: "playlist:add",
        actorUserId: "u2",
        actorUsername: "Bob",
        payload: { itemName: "Trailer" },
        at: 200,
      }),
      entry({
        id: "c",
        action: "participant:error",
        actorUserId: "u1",
        actorUsername: "Ada",
        error: "decode failed",
        at: 300,
      }),
    ]

    expect(
      getFilteredLogs({
        actionLog: logs,
        categories: ["playlist"],
      }).map((log) => log.id),
    ).toEqual(["b"])

    expect(
      getFilteredLogs({
        actionLog: logs,
        userIds: ["u1", "u2"],
        query: "trailer",
      }).map((log) => log.id),
    ).toEqual(["b"])

    expect(
      getFilteredLogs({
        actionLog: logs,
        timeStartMs: 150,
        timeEndMs: 250,
      }).map((log) => log.id),
    ).toEqual(["b"])

    expect(
      getFilteredLogs({
        actionLog: logs,
        query: "decode",
      }).map((log) => log.id),
    ).toEqual(["c"])
  })

  test("counts by category and highlights query segments", () => {
    const logs = [
      entry({ action: "playback:pause" }),
      entry({ action: "playlist:add" }),
      entry({ action: "participant:error", error: "x" }),
      entry({ action: "room:password:set" }),
    ]
    expect(countLogsByCategory(logs)).toEqual({
      presence: 0,
      playback: 1,
      playlist: 1,
      error: 1,
    })

    expect(highlightQuerySegments("Seeked from 0:05", "from")).toEqual([
      { text: "Seeked ", match: false },
      { text: "from", match: true },
      { text: " 0:05", match: false },
    ])
  })

  test("exposes structured payload rows for details-on-demand", () => {
    expect(
      getActionLogPayloadRows(
        entry({
          action: "playback:seek",
          payload: { fromMs: 1000, toMs: 2000, note: "jump" },
        }),
      ),
    ).toEqual([
      { key: "fromMs", value: "0:01" },
      { key: "toMs", value: "0:02" },
      { key: "note", value: "jump" },
    ])
  })
})
