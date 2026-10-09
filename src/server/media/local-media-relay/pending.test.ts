import { afterEach, describe, expect, test } from "bun:test"
import {
  createPending,
  pendingMap,
  resolveLocalMediaChunk,
  settlePending,
} from "@/server/media/local-media-relay/pending"
import { LocalMediaRelayError } from "@/server/media/local-media-relay/types"

afterEach(() => {
  for (const [requestId, pending] of pendingMap()) {
    clearTimeout(pending.timer)
    pendingMap().delete(requestId)
  }
})

describe("settlePending / createPending", () => {
  test("resolves a pending request and clears the timer", async () => {
    const requestId = "pending-ok"
    const promise = createPending(requestId, 5_000)
    expect(pendingMap().has(requestId)).toBe(true)

    const settled = settlePending(requestId, {
      requestId,
      ok: true,
      data: new Uint8Array([1]),
    })
    expect(settled).toBe(true)
    expect(pendingMap().has(requestId)).toBe(false)

    const payload = await promise
    expect(payload.ok).toBe(true)
    expect(payload.data).toEqual(new Uint8Array([1]))
  })

  test("returns false when no pending entry exists", () => {
    expect(
      settlePending("missing", { requestId: "missing", ok: false }),
    ).toBe(false)
  })

  test("rejects on timeout with provider_timeout", async () => {
    const requestId = "pending-timeout"
    const promise = createPending(requestId, 10)
    await expect(promise).rejects.toBeInstanceOf(LocalMediaRelayError)
    await expect(promise).rejects.toMatchObject({ code: "provider_timeout" })
    expect(pendingMap().has(requestId)).toBe(false)
  })
})

describe("resolveLocalMediaChunk", () => {
  test("settles local pending without requiring Redis", async () => {
    const requestId = "resolve-local"
    const promise = createPending(requestId, 5_000)

    resolveLocalMediaChunk({
      requestId,
      ok: true,
      dataBase64: Buffer.from([7, 8]).toString("base64"),
    })

    const payload = await promise
    expect(payload.ok).toBe(true)
    expect(payload.dataBase64).toBe(Buffer.from([7, 8]).toString("base64"))
  })

  test("ignores payloads without requestId", () => {
    expect(() =>
      resolveLocalMediaChunk({
        requestId: "",
        ok: false,
      }),
    ).not.toThrow()
  })
})
