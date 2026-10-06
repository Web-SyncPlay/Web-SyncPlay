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
})
