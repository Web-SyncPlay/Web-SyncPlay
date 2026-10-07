import { describe, expect, test } from "bun:test"
import {
  aggregateLocalPlaybackReports,
  clientPresencePatch,
  LOCAL_PLAYBACK_REPORT_STALE_MS,
  pruneLocalPlaybackReports,
  removeLocalPlaybackReport,
  upsertLocalPlaybackReport,
} from "./local-playback-presence"

describe("local playback presence aggregation", () => {
  test("loading is true only when every fresh report is loading", () => {
    const now = 10_000
    const aggregated = aggregateLocalPlaybackReports(
      {
        room: {
          sessionKind: "room",
          paused: false,
          currentTimeMs: 1000,
          loading: true,
          updatedAt: now,
        },
        player: {
          sessionKind: "player",
          paused: false,
          currentTimeMs: 1100,
          loading: false,
          updatedAt: now,
        },
      },
      now,
    )

    expect(aggregated?.loading).toBe(false)
    expect(aggregated?.currentTimeMs).toBe(1100)
  })

  test("prefers player session clock when both are ready", () => {
    const now = 10_000
    const aggregated = aggregateLocalPlaybackReports(
      {
        room: {
          sessionKind: "room",
          paused: true,
          currentTimeMs: 500,
          loading: false,
          updatedAt: now,
        },
        player: {
          sessionKind: "player",
          paused: false,
          currentTimeMs: 900,
          loading: false,
          updatedAt: now - 1,
        },
      },
      now,
    )

    expect(aggregated?.paused).toBe(false)
    expect(aggregated?.currentTimeMs).toBe(900)
  })

  test("prunes stale reports before aggregating", () => {
    const now = 50_000
    const aggregated = aggregateLocalPlaybackReports(
      {
        stale: {
          sessionKind: "room",
          paused: false,
          currentTimeMs: 1,
          loading: true,
          updatedAt: now - LOCAL_PLAYBACK_REPORT_STALE_MS - 1,
        },
        fresh: {
          sessionKind: "player",
          paused: false,
          currentTimeMs: 2,
          loading: false,
          updatedAt: now,
        },
      },
      now,
    )

    expect(aggregated?.loading).toBe(false)
    expect(aggregated?.currentTimeMs).toBe(2)
    expect(
      pruneLocalPlaybackReports(
        {
          stale: {
            sessionKind: "room",
            paused: false,
            currentTimeMs: 1,
            loading: true,
            updatedAt: now - LOCAL_PLAYBACK_REPORT_STALE_MS - 1,
          },
        },
        now,
      ),
    ).toEqual({})
  })

  test("upsert and remove maintain per-connection samples", () => {
    const now = 20_000
    const reports = upsertLocalPlaybackReport({
      reports: {},
      connectionId: "a",
      sessionKind: "room",
      snapshot: {
        paused: false,
        currentTimeMs: 100,
        loading: true,
        updatedAt: now,
      },
    })
    const withPlayer = upsertLocalPlaybackReport({
      reports,
      connectionId: "b",
      sessionKind: "player",
      snapshot: {
        paused: false,
        currentTimeMs: 200,
        loading: false,
        updatedAt: now,
      },
    })
    expect(aggregateLocalPlaybackReports(withPlayer, now)?.loading).toBe(false)

    const afterRemove = removeLocalPlaybackReport(withPlayer, "b", now)
    expect(aggregateLocalPlaybackReports(afterRemove, now)?.loading).toBe(true)
  })

  test("clientPresencePatch strips server-only reports", () => {
    expect(
      clientPresencePatch({
        connected: true,
        localPlayback: {
          paused: false,
          currentTimeMs: 1,
          loading: false,
          updatedAt: 1,
        },
        localPlaybackReports: {
          a: {
            sessionKind: "room",
            paused: false,
            currentTimeMs: 1,
            loading: false,
            updatedAt: 1,
          },
        },
      }).localPlaybackReports,
    ).toBeUndefined()
  })
})
