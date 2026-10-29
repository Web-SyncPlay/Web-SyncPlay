import { beforeEach, describe, expect, test } from "bun:test"

import {
  estimateServerClockOffsetMs,
  getLastRttMs,
  observeRttMs,
  observeServerNowMs,
  resetServerClockOffsetForTests,
  SERVER_CLOCK_OFFSET_OUTLIER_MS,
  serverNowEstimateMs,
  setServerClockOffsetMs,
} from "./server-clock"

describe("server-clock", () => {
  beforeEach(() => {
    resetServerClockOffsetForTests()
  })

  test("estimateServerClockOffsetMs applies half-RTT", () => {
    expect(estimateServerClockOffsetMs(1_000, 900, 100)).toBe(150)
  })

  test("observeServerNowMs seeds then EMA-blends", () => {
    expect(observeServerNowMs(1_100, 1_000)).toBe(100)
    expect(serverNowEstimateMs(1_000)).toBe(1_100)
    const blended = observeServerNowMs(1_200, 1_000)
    expect(blended).toBeCloseTo(100 * 0.8 + 200 * 0.2, 5)
  })

  test("setServerClockOffsetMs is used by estimate", () => {
    setServerClockOffsetMs(-50)
    expect(serverNowEstimateMs(1_000)).toBe(950)
  })

  test("observeRttMs seeds then EMA-blends", () => {
    expect(observeRttMs(100)).toBe(100)
    expect(getLastRttMs()).toBe(100)
    const blended = observeRttMs(200)
    expect(blended).toBeCloseTo(100 * 0.7 + 200 * 0.3, 5)
    expect(getLastRttMs()).toBeCloseTo(blended, 5)
  })

  test("observeServerNowMs uses last RTT when rttMs omitted", () => {
    observeRttMs(200)
    // server 1000, client 900, half-RTT 100 → offset 200
    expect(observeServerNowMs(1_000, 900)).toBe(200)
  })

  test("observeServerNowMs records explicit rttMs", () => {
    observeServerNowMs(1_000, 900, 100)
    expect(getLastRttMs()).toBe(100)
    expect(serverNowEstimateMs(900)).toBe(1_050)
  })

  test("rejects outlier samples after seed (stale timeline stamp poison)", () => {
    observeServerNowMs(1_000, 1_000) // offset 0
    // Stale stamp from 30s ago would look like offset -30000
    const kept = observeServerNowMs(
      1_000,
      1_000 + SERVER_CLOCK_OFFSET_OUTLIER_MS + 5_000,
    )
    expect(kept).toBe(0)
    expect(serverNowEstimateMs(1_000)).toBe(1_000)
  })

  test("accepts samples within the outlier bound", () => {
    observeServerNowMs(1_000, 1_000) // offset 0
    const next = observeServerNowMs(1_500, 1_000) // sample +500
    expect(next).toBeCloseTo(0 * 0.8 + 500 * 0.2, 5)
  })
})
