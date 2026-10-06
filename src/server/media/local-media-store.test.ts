import { describe, expect, test } from "bun:test"
import {
  createLocalMediaEntry,
  deleteLocalMediaEntry,
  getLocalMediaEntry,
} from "@/server/media/local-media-store"

describe("local-media-store metadata", () => {
  test("creates and reads metadata without storing file bytes", async () => {
    const id = crypto.randomUUID()
    const entry = await createLocalMediaEntry({
      id,
      roomId: "room-meta",
      ownerUserId: "owner-1",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 12_345,
    })

    expect(entry.id).toBe(id)
    expect(entry.sizeBytes).toBe(12_345)
    expect("tempFilePath" in entry).toBe(false)

    const loaded = await getLocalMediaEntry(id)
    expect(loaded?.filename).toBe("clip.mp4")
    expect(loaded?.mimeType).toBe("video/mp4")

    await deleteLocalMediaEntry(id)
    expect(await getLocalMediaEntry(id)).toBeNull()
  })
})
