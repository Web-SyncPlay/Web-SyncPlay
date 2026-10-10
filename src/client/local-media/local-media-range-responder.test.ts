import { describe, expect, test } from "bun:test"
import {
  LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH,
  LOCAL_MEDIA_MAX_BLOCK_BYTES,
} from "@/shared/local-media/local-media-block-protocol"
import {
  createRangeResponder,
  fetchLocalMediaRangeBytes,
  serveLocalMediaRange,
} from "./local-media-range-responder"

function blobOf(bytes: number[]) {
  return new Blob([new Uint8Array(bytes)])
}

describe("serveLocalMediaRange", () => {
  test("returns bytes for a valid inclusive range", async () => {
    const result = await serveLocalMediaRange({
      file: blobOf([1, 2, 3, 4, 5]),
      start: 1,
      end: 3,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect([...result.bytes]).toEqual([2, 3, 4])
    }
  })

  test("returns provider_unavailable when file is missing", async () => {
    const result = await serveLocalMediaRange({
      file: null,
      start: 0,
      end: 1,
      requestId: "r1",
    })
    expect(result).toEqual({
      ok: false,
      error: "provider_unavailable",
      requestId: "r1",
    })
  })

  test("returns invalid_range for non-numeric or inverted bounds", async () => {
    const file = blobOf([1, 2, 3])
    const a = await serveLocalMediaRange({ file, start: -1, end: 1 })
    const b = await serveLocalMediaRange({ file, start: 2, end: 1 })
    const c = await serveLocalMediaRange({ file, start: "0", end: 1 })
    expect(a.ok).toBe(false)
    expect(b.ok).toBe(false)
    expect(c.ok).toBe(false)
    if (!a.ok && !b.ok && !c.ok) {
      expect(a.error).toBe("invalid_range")
      expect(b.error).toBe("invalid_range")
      expect(c.error).toBe("invalid_range")
    }
  })

  test("returns range_too_large when the block exceeds the max", async () => {
    const file = blobOf(Array.from({ length: 8 }, (_, i) => i))
    const result = await serveLocalMediaRange({
      file,
      start: 0,
      end: 4,
      maxBlockBytes: 4,
    })
    expect(result).toEqual({ ok: false, error: "range_too_large" })
  })

  test("defaults max block to LOCAL_MEDIA_MAX_BLOCK_BYTES", async () => {
    const file = new Blob([new Uint8Array(LOCAL_MEDIA_MAX_BLOCK_BYTES + 1)])
    const result = await serveLocalMediaRange({
      file,
      start: 0,
      end: LOCAL_MEDIA_MAX_BLOCK_BYTES,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("range_too_large")
    }
  })

  test("rejects short request ids when requireRequestIdLength is set", async () => {
    const result = await serveLocalMediaRange({
      file: blobOf([1]),
      start: 0,
      end: 0,
      requestId: "short",
      requireRequestIdLength: true,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("provider_unavailable")
    }
  })

  test("accepts UUID-length request ids when required", async () => {
    const requestId = "a".repeat(LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH)
    const result = await serveLocalMediaRange({
      file: blobOf([9]),
      start: 0,
      end: 0,
      requestId,
      requireRequestIdLength: true,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.requestId).toBe(requestId)
      expect([...result.bytes]).toEqual([9])
    }
  })

  test("returns timeout when AbortSignal is already aborted", async () => {
    const signal = AbortSignal.abort()
    const result = await serveLocalMediaRange({
      file: blobOf([1, 2]),
      start: 0,
      end: 1,
      signal,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("timeout")
    }
  })

  test("returns timeout when timeoutMs elapses before read completes", async () => {
    const slowFile = {
      slice() {
        return {
          async arrayBuffer() {
            await new Promise((resolve) => setTimeout(resolve, 200))
            return new Uint8Array([1]).buffer
          },
        }
      },
    } as unknown as Blob

    const result = await serveLocalMediaRange({
      file: slowFile,
      start: 0,
      end: 0,
      timeoutMs: 5,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe("timeout")
    }
  })
})

describe("fetchLocalMediaRangeBytes", () => {
  test("returns null on validation errors", async () => {
    const bytes = await fetchLocalMediaRangeBytes(blobOf([1]), 2, 1)
    expect(bytes).toBeNull()
  })

  test("returns bytes on success", async () => {
    const bytes = await fetchLocalMediaRangeBytes(blobOf([4, 5, 6]), 0, 1)
    expect(bytes && [...bytes]).toEqual([4, 5])
  })
})

describe("createRangeResponder", () => {
  test("serve/fetch resolve files and invoke onServed once per success", async () => {
    const id = "media-1"
    const served: string[] = []
    const responder = createRangeResponder({
      getFile: (localMediaId) =>
        localMediaId === id ? blobOf([10, 20, 30]) : null,
      onServed: (localMediaId) => served.push(localMediaId),
    })

    const miss = await responder.fetch({
      localMediaId: "missing",
      start: 0,
      end: 0,
    })
    expect(miss).toBeNull()
    expect(served).toEqual([])

    const hit = await responder.serve({
      localMediaId: id,
      start: 1,
      end: 2,
    })
    expect(hit.ok).toBe(true)
    if (hit.ok) {
      expect([...hit.bytes]).toEqual([20, 30])
    }
    expect(served).toEqual([id])
  })
})
