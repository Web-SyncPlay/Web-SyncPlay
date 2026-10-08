import { describe, expect, test } from "bun:test"

import {
  msToSamples,
  planEarlySkewChange,
  processSkewQuantum,
  shouldLeaveNegativePath,
  type AudioSkewPlan,
  type StereoFrame,
} from "./audio-delay-skew"

function frames(...values: number[]): StereoFrame[] {
  return values.map((value) => ({ left: value, right: value }))
}

describe("msToSamples", () => {
  test("converts milliseconds at common sample rates", () => {
    expect(msToSamples(1000, 48_000)).toBe(48_000)
    expect(msToSamples(214, 48_000)).toBe(10_272)
    expect(msToSamples(0, 48_000)).toBe(0)
  })

  test("guards non-finite and non-positive rates", () => {
    expect(msToSamples(Number.NaN, 48_000)).toBe(0)
    expect(msToSamples(100, 0)).toBe(0)
    expect(msToSamples(100, -1)).toBe(0)
  })
})

describe("planEarlySkewChange", () => {
  const idle: AudioSkewPlan = {
    appliedEarlyMs: 0,
    samplesToDrop: 0,
    samplesToInsert: 0,
  }

  test("positive early delta schedules drops", () => {
    const next = planEarlySkewChange(idle, 214, 48_000)
    expect(next.appliedEarlyMs).toBe(214)
    expect(next.samplesToDrop).toBe(msToSamples(214, 48_000))
    expect(next.samplesToInsert).toBe(0)
  })

  test("reducing early skew after drops already applied schedules inserts", () => {
    const armed = planEarlySkewChange(idle, 214, 48_000)
    // Processor already consumed the pending drops.
    const current = { ...armed, samplesToDrop: 0 }
    const next = planEarlySkewChange(current, 100, 48_000)
    expect(next.appliedEarlyMs).toBe(100)
    expect(next.samplesToDrop).toBe(0)
    expect(next.samplesToInsert).toBe(msToSamples(114, 48_000))
  })

  test("opposing corrections cancel unapplied work instead of stacking", () => {
    const withDrop = planEarlySkewChange(idle, 100, 48_000)
    // Before drops drain, move back toward zero — pending drop is cancelled.
    const next = planEarlySkewChange(withDrop, 0, 48_000)
    expect(next.appliedEarlyMs).toBe(0)
    expect(next.samplesToDrop).toBe(0)
    expect(next.samplesToInsert).toBe(0)
  })

  test("partially applied drops leave only the residual insert", () => {
    const armed = planEarlySkewChange(idle, 100, 48_000)
    const half = Math.floor(armed.samplesToDrop / 2)
    const current = { ...armed, samplesToDrop: armed.samplesToDrop - half }
    const next = planEarlySkewChange(current, 0, 48_000)
    expect(next.samplesToDrop).toBe(0)
    expect(next.samplesToInsert).toBe(half)
  })

  test("clamps negative targets to zero early-ms", () => {
    const next = planEarlySkewChange(idle, -50, 48_000)
    expect(next.appliedEarlyMs).toBe(0)
    expect(next.samplesToDrop).toBe(0)
  })
})

describe("processSkewQuantum", () => {
  test("passthrough keeps A/V aligned when no skew work is pending", () => {
    const result = processSkewQuantum({
      frames: frames(1, 2, 3, 4),
      pending: [],
      samplesToDrop: 0,
      samplesToInsert: 0,
      outputFrameCount: 4,
    })
    expect(result.output.map((frame) => frame.left)).toEqual([1, 2, 3, 4])
    expect(result.pending).toEqual([])
    expect(result.samplesToDrop).toBe(0)
    expect(result.samplesToInsert).toBe(0)
  })

  test("drops advance audio relative to video without losing later samples", () => {
    const result = processSkewQuantum({
      frames: frames(1, 2, 3, 4, 5, 6),
      pending: [],
      samplesToDrop: 2,
      samplesToInsert: 0,
      outputFrameCount: 6,
    })
    // First two content frames dropped; remaining content then silence pad.
    expect(result.output.map((frame) => frame.left)).toEqual([
      3, 4, 5, 6, 0, 0,
    ])
    expect(result.samplesToDrop).toBe(0)
    expect(result.pending).toEqual([])
  })

  test("inserts delay audio catch-up when reducing negative offset", () => {
    const result = processSkewQuantum({
      frames: frames(1, 2, 3, 4),
      pending: [],
      samplesToDrop: 0,
      samplesToInsert: 2,
      outputFrameCount: 4,
    })
    expect(result.output.map((frame) => frame.left)).toEqual([0, 0, 1, 2])
    expect(result.pending.map((frame) => frame.left)).toEqual([3, 4])
    expect(result.samplesToInsert).toBe(0)
  })

  test("carries pending frames across quanta", () => {
    const first = processSkewQuantum({
      frames: frames(1, 2, 3, 4),
      pending: [],
      samplesToDrop: 0,
      samplesToInsert: 2,
      outputFrameCount: 4,
    })
    const second = processSkewQuantum({
      frames: frames(5, 6),
      pending: first.pending,
      samplesToDrop: 0,
      samplesToInsert: first.samplesToInsert,
      outputFrameCount: 4,
    })
    expect(second.output.map((frame) => frame.left)).toEqual([3, 4, 5, 6])
    expect(second.pending).toEqual([])
  })

  test("drop larger than one quantum continues on the next quantum", () => {
    const first = processSkewQuantum({
      frames: frames(1, 2, 3),
      pending: [],
      samplesToDrop: 5,
      samplesToInsert: 0,
      outputFrameCount: 3,
    })
    expect(first.samplesToDrop).toBe(2)
    expect(first.output.map((frame) => frame.left)).toEqual([0, 0, 0])

    const second = processSkewQuantum({
      frames: frames(4, 5, 6, 7),
      pending: first.pending,
      samplesToDrop: first.samplesToDrop,
      samplesToInsert: 0,
      outputFrameCount: 4,
    })
    expect(second.samplesToDrop).toBe(0)
    expect(second.output.map((frame) => frame.left)).toEqual([6, 7, 0, 0])
  })
})

describe("shouldLeaveNegativePath", () => {
  test("stays engaged while early skew or pending work remains", () => {
    expect(
      shouldLeaveNegativePath({
        delayMs: -100,
        appliedEarlyMs: 100,
        samplesToDrop: 0,
        samplesToInsert: 0,
        pendingFrames: 0,
        negativePathActive: true,
      }),
    ).toBe(false)
    expect(
      shouldLeaveNegativePath({
        delayMs: 0,
        appliedEarlyMs: 0,
        samplesToDrop: 10,
        samplesToInsert: 0,
        pendingFrames: 0,
        negativePathActive: true,
      }),
    ).toBe(false)
    expect(
      shouldLeaveNegativePath({
        delayMs: 50,
        appliedEarlyMs: 0,
        samplesToDrop: 0,
        samplesToInsert: 0,
        pendingFrames: 3,
        negativePathActive: true,
      }),
    ).toBe(false)
  })

  test("leaves once delay is non-negative and all work is drained", () => {
    expect(
      shouldLeaveNegativePath({
        delayMs: 0,
        appliedEarlyMs: 0,
        samplesToDrop: 0,
        samplesToInsert: 0,
        pendingFrames: 0,
        negativePathActive: true,
      }),
    ).toBe(true)
    expect(
      shouldLeaveNegativePath({
        delayMs: 214,
        appliedEarlyMs: 0,
        samplesToDrop: 0,
        samplesToInsert: 0,
        pendingFrames: 0,
        negativePathActive: true,
      }),
    ).toBe(true)
  })
})
