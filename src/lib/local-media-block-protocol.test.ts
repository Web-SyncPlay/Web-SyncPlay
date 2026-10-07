import { describe, expect, test } from "bun:test"
import {
  encodeLocalMediaBlockMetaError,
  encodeLocalMediaBlockMetaOk,
  encodeLocalMediaBlockRequest,
  encodeLocalMediaSfuReadyAck,
  isLocalMediaBlockMeta,
  isLocalMediaBlockRequest,
  LOCAL_MEDIA_BLOCK_META,
  LOCAL_MEDIA_BLOCK_REQUEST,
  LOCAL_MEDIA_MAX_BLOCK_BYTES,
  parseLocalMediaBlockJson,
  parseLocalMediaSfuReadyAck,
} from "@/lib/local-media-block-protocol"

describe("local-media-block-protocol", () => {
  test("encodes block request/meta strings used on DataChannels", () => {
    const req = encodeLocalMediaBlockRequest("id-1", 0, 1023)
    expect(JSON.parse(req)).toEqual({
      t: LOCAL_MEDIA_BLOCK_REQUEST,
      requestId: "id-1",
      start: 0,
      end: 1023,
    })

    const ok = encodeLocalMediaBlockMetaOk("id-1", 1024)
    expect(JSON.parse(ok)).toEqual({
      t: LOCAL_MEDIA_BLOCK_META,
      requestId: "id-1",
      ok: true,
      byteLength: 1024,
    })

    const err = encodeLocalMediaBlockMetaError("id-1", "read_failed")
    expect(JSON.parse(err)).toEqual({
      t: LOCAL_MEDIA_BLOCK_META,
      requestId: "id-1",
      ok: false,
      error: "read_failed",
    })
  })

  test("parses control messages and rejects garbage", () => {
    const req = parseLocalMediaBlockJson(
      encodeLocalMediaBlockRequest("a", 1, 2),
    )
    expect(isLocalMediaBlockRequest(req)).toBe(true)
    expect(isLocalMediaBlockMeta(req)).toBe(false)

    const meta = parseLocalMediaBlockJson(
      encodeLocalMediaBlockMetaOk("a", 10),
    )
    expect(isLocalMediaBlockMeta(meta)).toBe(true)

    expect(parseLocalMediaBlockJson("not-json")).toBeNull()
    expect(
      parseLocalMediaSfuReadyAck(encodeLocalMediaSfuReadyAck("prod-1")),
    ).toBe("prod-1")
    expect(parseLocalMediaSfuReadyAck("{}")).toBeNull()
  })

  test("block size constant matches relay alignment", () => {
    expect(LOCAL_MEDIA_MAX_BLOCK_BYTES).toBe(256 * 1024)
  })
})
