import { afterEach, describe, expect, test } from "bun:test"
import {
  clearLogFilters,
  hasActiveLogFilters,
  peekLogFiltersState,
  resetLogFiltersStoreForTests,
  setLogFiltersQuery,
  setLogFiltersTimeRange,
  toggleLogFilterAction,
  toggleLogFilterCategory,
  toggleLogFilterUser,
} from "./use-log-filters"

describe("log filters store", () => {
  afterEach(() => {
    resetLogFiltersStoreForTests()
  })

  test("toggles categories/users/actions and clears", () => {
    const roomId = "room-a"
    expect(hasActiveLogFilters(peekLogFiltersState(roomId))).toBe(false)

    toggleLogFilterCategory(roomId, "playback")
    toggleLogFilterUser(roomId, "u1")
    toggleLogFilterAction(roomId, "playback:seek")
    setLogFiltersQuery(roomId, "seek")
    setLogFiltersTimeRange(roomId, 10, 20)

    const active = peekLogFiltersState(roomId)
    expect(active.categories).toEqual(["playback"])
    expect(active.userIds).toEqual(["u1"])
    expect(active.actions).toEqual(["playback:seek"])
    expect(active.query).toBe("seek")
    expect(active.timeStartMs).toBe(10)
    expect(active.timeEndMs).toBe(20)
    expect(hasActiveLogFilters(active)).toBe(true)

    toggleLogFilterCategory(roomId, "playback")
    expect(peekLogFiltersState(roomId).categories).toEqual([])

    clearLogFilters(roomId)
    expect(hasActiveLogFilters(peekLogFiltersState(roomId))).toBe(false)
  })

  test("keeps separate filter state per room id", () => {
    setLogFiltersQuery("room-a", "alpha")
    expect(peekLogFiltersState("room-a").query).toBe("alpha")

    setLogFiltersQuery("room-b", "beta")
    expect(peekLogFiltersState("room-b").query).toBe("beta")
    expect(peekLogFiltersState("room-a").query).toBe("alpha")
  })
})
