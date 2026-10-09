import { describe, expect, test } from "bun:test"
import {
  bytesFromChunkPayload,
  serializeRelayReplyPayload,
  throwFromChunkPayload,
} from "@/server/media/local-media-relay/chunk"
import { LocalMediaRelayError } from "@/server/media/local-media-relay/types"

describe("serializeRelayReplyPayload", () => {
  test("encodes Uint8Array data as dataBase64", () => {
    const serialized = serializeRelayReplyPayload({
      requestId: "req-1",
      ok: true,
      data: new Uint8Array([1, 2, 255]),
    })

    expect(serialized).toEqual({
      requestId: "req-1",
      ok: true,
      dataBase64: Buffer.from([1, 2, 255]).toString("base64"),
      error: undefined,
    })
  })

  test("passes through existing dataBase64 without re-encoding", () => {
    const serialized = serializeRelayReplyPayload({
      requestId: "req-2",
      ok: true,
      dataBase64: "YWI=",
    })

    expect(serialized.dataBase64).toBe("YWI=")
    expect(serialized.ok).toBe(true)
  })

  test("preserves error on failed payloads", () => {
    const serialized = serializeRelayReplyPayload({
      requestId: "req-3",
      ok: false,
      error: "read_failed",
    })

    expect(serialized).toEqual({
      requestId: "req-3",
      ok: false,
      dataBase64: undefined,
      error: "read_failed",
    })
  })
})

describe("bytesFromChunkPayload", () => {
  test("prefers raw data when present", () => {
    const raw = new Uint8Array([9, 8, 7])
    const bytes = bytesFromChunkPayload({
      requestId: "req",
      ok: true,
      data: raw,
      dataBase64: "ignored",
    })
    expect(bytes).toBe(raw)
  })

  test("decodes dataBase64 when raw data is absent", () => {
    const bytes = bytesFromChunkPayload({
      requestId: "req",
      ok: true,
      dataBase64: Buffer.from([4, 5, 6]).toString("base64"),
    })
    expect(bytes).not.toBeNull()
    expect([...bytes!]).toEqual([4, 5, 6])
  })

  test("returns null when neither data nor dataBase64 is set", () => {
    expect(
      bytesFromChunkPayload({
        requestId: "req",
        ok: false,
        error: "offline",
      }),
    ).toBeNull()
  })
})

describe("throwFromChunkPayload", () => {
  test("maps timeout messages to provider_timeout", () => {
    expect(() =>
      throwFromChunkPayload({
        requestId: "req",
        ok: false,
        error: "provider timed out",
      }),
    ).toThrow(LocalMediaRelayError)

    try {
      throwFromChunkPayload({
        requestId: "req",
        ok: false,
        error: "provider timed out",
      })
    } catch (error) {
      expect(error).toBeInstanceOf(LocalMediaRelayError)
      expect((error as LocalMediaRelayError).code).toBe("provider_timeout")
      expect((error as LocalMediaRelayError).name).toBe("LocalMediaRelayError")
    }
  })

  test("defaults unknown errors to relay_failed", () => {
    try {
      throwFromChunkPayload({
        requestId: "req",
        ok: false,
        error: "something else",
      })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(LocalMediaRelayError)
      expect((error as LocalMediaRelayError).code).toBe("relay_failed")
      expect((error as LocalMediaRelayError).message).toBe("something else")
    }
  })
})
