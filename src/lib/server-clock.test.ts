import { describe, expect, test, beforeEach } from "bun:test"
import {
  estimateServerClockOffsetMs,
  observeServerNowMs,
  resetServerClockOffsetForTests,
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
})
