import { describe, expect, test } from "bun:test"
import {
  decodeLocalMediaChunkFrame,
  encodeLocalMediaChunkFrame,
  isLocalMediaChunkFrame,
  LMC_FLAG_OK,
  LMC_MAGIC,
} from "@/shared/local-media/local-media-binary"

describe("local-media-binary", () => {
  test("round-trips ok frame with media bytes", () => {
    const data = new Uint8Array([0, 1, 2, 255, 128, 64])
    const encoded = encodeLocalMediaChunkFrame({
      requestId: "req-abc-123",
      ok: true,
      data,
    })

    expect(isLocalMediaChunkFrame(encoded)).toBe(true)
    const view = new DataView(
      encoded.buffer,
      encoded.byteOffset,
      encoded.byteLength,
    )
    expect(view.getUint32(0, true)).toBe(LMC_MAGIC)
    expect(encoded[6 + "req-abc-123".length]).toBe(LMC_FLAG_OK)

    const decoded = decodeLocalMediaChunkFrame(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.requestId).toBe("req-abc-123")
    expect(decoded!.ok).toBe(true)
    expect(decoded!.data).toEqual(data)
    expect(decoded!.error).toBeUndefined()
  })

  test("round-trips error frame", () => {
    const encoded = encodeLocalMediaChunkFrame({
      requestId: "req-err",
      ok: false,
      error: "read_failed",
    })

    const decoded = decodeLocalMediaChunkFrame(encoded)
    expect(decoded).not.toBeNull()
    expect(decoded!.requestId).toBe("req-err")
    expect(decoded!.ok).toBe(false)
    expect(decoded!.error).toBe("read_failed")
    expect(decoded!.data).toBeUndefined()
  })

  test("round-trips empty ok body", () => {
    const encoded = encodeLocalMediaChunkFrame({
      requestId: "empty",
      ok: true,
      data: new Uint8Array(0),
    })
    const decoded = decodeLocalMediaChunkFrame(encoded)
    expect(decoded!.ok).toBe(true)
    expect(decoded!.data).toEqual(new Uint8Array(0))
  })

  test("returns null for non-LMC buffers", () => {
    expect(decodeLocalMediaChunkFrame(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(
      decodeLocalMediaChunkFrame(new TextEncoder().encode('{"type":"x"}')),
    ).toBeNull()
    expect(isLocalMediaChunkFrame(new Uint8Array(3))).toBe(false)
  })

  test("returns null for truncated frames", () => {
    const full = encodeLocalMediaChunkFrame({
      requestId: "truncate-me",
      ok: true,
      data: new Uint8Array([9, 8, 7]),
    })
    expect(decodeLocalMediaChunkFrame(full.subarray(0, 6))).toBeNull()
    // Claim a longer requestId than remaining bytes
    const truncated = full.slice(0, 10)
    const view = new DataView(
      truncated.buffer,
      truncated.byteOffset,
      truncated.byteLength,
    )
    view.setUint16(4, 100, true)
    expect(decodeLocalMediaChunkFrame(truncated)).toBeNull()
  })

  test("decoded data is a copy (not a live view of the frame)", () => {
    const encoded = encodeLocalMediaChunkFrame({
      requestId: "copy",
      ok: true,
      data: new Uint8Array([42]),
    })
    const decoded = decodeLocalMediaChunkFrame(encoded)!
    encoded[encoded.byteLength - 1] = 0
    expect(decoded.data![0]).toBe(42)
  })
})
