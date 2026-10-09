import { describe, expect, test } from "bun:test"
import {
  decideSfuProducerWireAction,
  ENSURE_RETRY_COOLDOWN_MS,
  isSfuSessionGenerationCurrent,
  isSfuViewerChannelReady,
  nextDeliveryModeAfterFailure,
  nextSfuSessionGeneration,
  pickFirstReadyDeliveryMode,
  planLocalMediaDeliveryAttempts,
  planSfuProvideAttempt,
  shouldActAsSfuViewer,
  shouldEnsureSfuProvider,
  shouldWarmSfuViewer,
} from "./local-media-sfu-transitions"

describe("planLocalMediaDeliveryAttempts", () => {
  test("orders SFU → P2P → HTTP when SFU available and provider known", () => {
    expect(
      planLocalMediaDeliveryAttempts({
        sfuAvailable: true,
        sfuViewerReady: false,
        providerUserId: "u1",
      }).map((a) => a.mode),
    ).toEqual(["sfu", "p2p", "http"])
  })

  test("skips SFU when unavailable", () => {
    expect(
      planLocalMediaDeliveryAttempts({
        sfuAvailable: false,
        sfuViewerReady: false,
        providerUserId: "u1",
      }).map((a) => a.mode),
    ).toEqual(["p2p", "http"])
  })

  test("skips P2P when provider unknown", () => {
    expect(
      planLocalMediaDeliveryAttempts({
        sfuAvailable: true,
        sfuViewerReady: true,
        providerUserId: null,
      }).map((a) => a.mode),
    ).toEqual(["sfu", "http"])
  })
})

describe("pickFirstReadyDeliveryMode", () => {
  test("skips cold SFU and picks P2P", () => {
    const attempts = planLocalMediaDeliveryAttempts({
      sfuAvailable: true,
      sfuViewerReady: false,
      providerUserId: "u1",
    })
    expect(pickFirstReadyDeliveryMode(attempts)).toBe("p2p")
  })

  test("prefers warm SFU", () => {
    const attempts = planLocalMediaDeliveryAttempts({
      sfuAvailable: true,
      sfuViewerReady: true,
      providerUserId: "u1",
    })
    expect(pickFirstReadyDeliveryMode(attempts)).toBe("sfu")
  })
})

describe("nextDeliveryModeAfterFailure", () => {
  test("falls from SFU to P2P then HTTP", () => {
    const attempts = planLocalMediaDeliveryAttempts({
      sfuAvailable: true,
      sfuViewerReady: true,
      providerUserId: "u1",
    })
    expect(nextDeliveryModeAfterFailure(attempts, "sfu")).toBe("p2p")
    expect(nextDeliveryModeAfterFailure(attempts, "p2p")).toBe("http")
    expect(nextDeliveryModeAfterFailure(attempts, "http")).toBeNull()
  })

  test("skips cold SFU when falling from an unknown failure", () => {
    const attempts = planLocalMediaDeliveryAttempts({
      sfuAvailable: true,
      sfuViewerReady: false,
      providerUserId: null,
    })
    expect(nextDeliveryModeAfterFailure(attempts, "p2p")).toBe("http")
  })
})

describe("session generation invalidation", () => {
  test("detects stale async work", () => {
    expect(isSfuSessionGenerationCurrent(3, 3)).toBe(true)
    expect(isSfuSessionGenerationCurrent(4, 3)).toBe(false)
  })

  test("bumps generation for tear-down", () => {
    expect(nextSfuSessionGeneration(0)).toBe(1)
    expect(nextSfuSessionGeneration(7)).toBe(8)
  })
})

describe("viewer channel readiness", () => {
  test("requires ready ack and open channels", () => {
    expect(
      isSfuViewerChannelReady({
        ready: true,
        requestProducerClosed: false,
        consumerClosed: false,
      }),
    ).toBe(true)
    expect(
      isSfuViewerChannelReady({
        ready: false,
        requestProducerClosed: false,
        consumerClosed: false,
      }),
    ).toBe(false)
    expect(
      isSfuViewerChannelReady({
        ready: true,
        requestProducerClosed: true,
        consumerClosed: false,
      }),
    ).toBe(false)
    expect(
      isSfuViewerChannelReady({
        ready: true,
        requestProducerClosed: false,
        consumerClosed: true,
      }),
    ).toBe(false)
  })
})

describe("produce/consume role gates", () => {
  test("file holders provide; others view", () => {
    expect(shouldEnsureSfuProvider(true)).toBe(true)
    expect(shouldEnsureSfuProvider(false)).toBe(false)
    expect(shouldActAsSfuViewer(true)).toBe(false)
    expect(shouldActAsSfuViewer(false)).toBe(true)
  })

  test("provide queues until SFU available", () => {
    expect(planSfuProvideAttempt(false)).toBe("queue")
    expect(planSfuProvideAttempt(true)).toBe("provide")
  })
})

describe("shouldWarmSfuViewer", () => {
  test("respects in-flight ensure, local file, and failure cooldown", () => {
    expect(
      shouldWarmSfuViewer({
        holdsLocalFile: true,
        hasInFlightEnsure: false,
        lastFailureAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false)
    expect(
      shouldWarmSfuViewer({
        holdsLocalFile: false,
        hasInFlightEnsure: true,
        lastFailureAtMs: 0,
        nowMs: 10_000,
      }),
    ).toBe(false)
    expect(
      shouldWarmSfuViewer({
        holdsLocalFile: false,
        hasInFlightEnsure: false,
        lastFailureAtMs: 9_000,
        nowMs: 9_000 + ENSURE_RETRY_COOLDOWN_MS - 1,
      }),
    ).toBe(false)
    expect(
      shouldWarmSfuViewer({
        holdsLocalFile: false,
        hasInFlightEnsure: false,
        lastFailureAtMs: 9_000,
        nowMs: 9_000 + ENSURE_RETRY_COOLDOWN_MS,
      }),
    ).toBe(true)
  })
})

describe("decideSfuProducerWireAction", () => {
  test("no-ops when SFU unavailable", () => {
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: false,
        kind: "provider",
        isSelfOwner: false,
        holdsLocalFile: false,
      }),
    ).toBe("noop")
  })

  test("owner with file consumes request channels", () => {
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: true,
        kind: "requests",
        isSelfOwner: true,
        holdsLocalFile: true,
      }),
    ).toBe("consume-requests")
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: true,
        kind: "requests",
        isSelfOwner: true,
        holdsLocalFile: false,
      }),
    ).toBe("noop")
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: true,
        kind: "requests",
        isSelfOwner: false,
        holdsLocalFile: true,
      }),
    ).toBe("noop")
  })

  test("non-holders ensure viewer for provider produce", () => {
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: true,
        kind: "provider",
        isSelfOwner: false,
        holdsLocalFile: false,
      }),
    ).toBe("ensure-viewer")
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: true,
        kind: undefined,
        isSelfOwner: false,
        holdsLocalFile: false,
      }),
    ).toBe("ensure-viewer")
    expect(
      decideSfuProducerWireAction({
        sfuAvailable: true,
        kind: "provider",
        isSelfOwner: true,
        holdsLocalFile: true,
      }),
    ).toBe("noop")
  })
})
