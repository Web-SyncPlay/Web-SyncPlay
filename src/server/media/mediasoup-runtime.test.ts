import { afterAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"

// Importing the runtime pulls in the env schema, which requires VALKEY_URL.
process.env.SKIP_ENV_VALIDATION ??= "1"

const runtimeModule = await import("@/server/media/mediasoup-runtime")

// The native worker binary is not built on every machine, and spawning a
// missing binary surfaces as an unhandled child-process error, so probe first.
const { workerBin } = await import("mediasoup")
const runtime = existsSync(workerBin)
  ? await runtimeModule.ensureMediasoupRuntime()
  : null

const sfuTest = runtime ? test : test.skip

describe("mediasoup-runtime", () => {
  afterAll(() => {
    runtime?.worker.close()
  })

  test("local media producer lookup is empty without producers", () => {
    expect(
      runtimeModule.getLocalMediaSfuProducer(crypto.randomUUID()),
    ).toBeNull()
    expect(runtimeModule.listLocalMediaSfuProducers()).toEqual([])
  })

  test("worker-died listeners fire when notified", () => {
    let calls = 0
    const stop = runtimeModule.onMediasoupWorkerDied(() => {
      calls += 1
    })
    runtimeModule.notifyMediasoupWorkerDiedForTests()
    expect(calls).toBe(1)
    stop()
    runtimeModule.notifyMediasoupWorkerDiedForTests()
    expect(calls).toBe(1)
  })

  sfuTest("creates a router and a WebRTC transport with SCTP", async () => {
    const roomKey = `test-room-${crypto.randomUUID()}`
    const router = await runtimeModule.mediasoupCreateRouter(roomKey)
    expect(router.routerId).toBeTruthy()

    const transport = await runtimeModule.mediasoupCreateTransport(roomKey, {
      direction: "send",
    })
    expect(transport.id).toBeTruthy()
    expect(transport.sctpParameters).toBeDefined()
    expect(
      runtimeModule.getMediasoupTransportAppData(transport.id),
    ).toMatchObject({ roomKey, direction: "send" })

    runtimeModule.mediasoupCloseTransport(transport.id)
    expect(runtimeModule.getMediasoupTransportAppData(transport.id)).toBeNull()
  })

  sfuTest("closeLocalMediaSfuDataProducer only closes one producer", async () => {
    const roomKey = `test-room-${crypto.randomUUID()}`
    await runtimeModule.mediasoupCreateRouter(roomKey)
    const transport = await runtimeModule.mediasoupCreateTransport(roomKey, {
      direction: "send",
    })
    const mediaId = crypto.randomUUID()
    const provider = await runtimeModule.mediasoupProduceData({
      transportId: transport.id,
      sctpStreamParameters: { streamId: 0, ordered: true },
      appData: {
        localMediaId: mediaId,
        roomId: roomKey,
        ownerUserId: "owner",
        role: "provider",
      },
    })
    const request = await runtimeModule.mediasoupProduceData({
      transportId: transport.id,
      sctpStreamParameters: { streamId: 1, ordered: true },
      appData: {
        localMediaId: mediaId,
        roomId: roomKey,
        ownerUserId: "owner",
        role: "requests",
      },
    })

    expect(runtimeModule.getLocalMediaSfuProducer(mediaId)?.dataProducerId).toBe(
      provider.id,
    )
    expect(runtimeModule.listLocalMediaSfuRequestProducers(mediaId)).toHaveLength(
      1,
    )

    runtimeModule.closeLocalMediaSfuDataProducer(provider.id)

    expect(runtimeModule.getLocalMediaSfuProducer(mediaId)).toBeNull()
    expect(runtimeModule.listLocalMediaSfuRequestProducers(mediaId)).toEqual([
      expect.objectContaining({ dataProducerId: request.id }),
    ])

    runtimeModule.clearLocalMediaSfuProducer(mediaId)
    runtimeModule.mediasoupCloseTransport(transport.id)
  })
})
