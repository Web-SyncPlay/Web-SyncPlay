import { describe, expect, test } from "bun:test"
import {
  alignedBlockStart,
  fetchLocalMediaAlignedBlock,
  fetchLocalMediaRangeBytes,
} from "@/server/media/local-media-relay/fetch"
import {
  LOCAL_MEDIA_RELAY_CHUNK_BYTES,
  LocalMediaRelayError,
} from "@/server/media/local-media-relay/types"
import type { LocalMediaEntry } from "@/server/media/local-media-store"

function entry(sizeBytes: number): LocalMediaEntry {
  return {
    id: "media-1",
    roomId: "room-1",
    ownerUserId: "owner-1",
    filename: "clip.mp4",
    mimeType: "video/mp4",
    sizeBytes,
    providerReady: false,
    createdAt: 1,
    expiresAt: 2,
  }
}

describe("alignedBlockStart", () => {
  test("snaps offsets down to chunk boundaries", () => {
    const chunk = 1024
    expect(alignedBlockStart(0, chunk)).toBe(0)
    expect(alignedBlockStart(1, chunk)).toBe(0)
    expect(alignedBlockStart(chunk - 1, chunk)).toBe(0)
    expect(alignedBlockStart(chunk, chunk)).toBe(chunk)
    expect(alignedBlockStart(chunk + 50, chunk)).toBe(chunk)
  })

  test("matches relay chunk size for mid-block offsets", () => {
    const mid = Math.floor(LOCAL_MEDIA_RELAY_CHUNK_BYTES / 2)
    expect(alignedBlockStart(mid, LOCAL_MEDIA_RELAY_CHUNK_BYTES)).toBe(0)
    expect(
      alignedBlockStart(
        LOCAL_MEDIA_RELAY_CHUNK_BYTES + mid,
        LOCAL_MEDIA_RELAY_CHUNK_BYTES,
      ),
    ).toBe(LOCAL_MEDIA_RELAY_CHUNK_BYTES)
  })
})

describe("fetchLocalMediaRangeBytes validation", () => {
  test("rejects negative, inverted, and past-EOF ranges", async () => {
    const media = entry(1000)

    await expect(fetchLocalMediaRangeBytes(media, -1, 10)).rejects.toBeInstanceOf(
      LocalMediaRelayError,
    )
    await expect(fetchLocalMediaRangeBytes(media, 20, 10)).rejects.toMatchObject({
      code: "invalid_range",
    })
    await expect(fetchLocalMediaRangeBytes(media, 1000, 1001)).rejects.toMatchObject({
      code: "invalid_range",
    })
  })
})

describe("fetchLocalMediaAlignedBlock validation", () => {
  test("rejects unaligned blockStart without provider I/O", async () => {
    await expect(
      fetchLocalMediaAlignedBlock(entry(LOCAL_MEDIA_RELAY_CHUNK_BYTES * 2), 1),
    ).rejects.toMatchObject({
      code: "invalid_range",
    })
  })
})

describe("LocalMediaRelayError", () => {
  test("uses code as default message", () => {
    const error = new LocalMediaRelayError("not_found")
    expect(error.code).toBe("not_found")
    expect(error.message).toBe("not_found")
    expect(error.name).toBe("LocalMediaRelayError")
  })
})
