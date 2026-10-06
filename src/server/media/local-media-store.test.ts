import { describe, expect, test } from "bun:test"
import { getCommandClient } from "@/server/redis/client"
import {
  clearLocalMediaProviderReadyForOwner,
  createLocalMediaEntry,
  deleteLocalMediaEntry,
  getLocalMediaEntry,
  setLocalMediaProviderReady,
} from "@/server/media/local-media-store"

async function redisAvailable(): Promise<boolean> {
  try {
    const client = await getCommandClient()
    await client.ping()
    return true
  } catch {
    return false
  }
}

const hasRedis = await redisAvailable()

describe.skipIf(!hasRedis)("local-media-store metadata", () => {
  if (!hasRedis) {
    console.warn(
      "[local-media-store.test] skipping: Redis/Valkey unavailable",
    )
  }

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
    expect(entry.providerReady).toBe(false)
    expect("tempFilePath" in entry).toBe(false)

    const loaded = await getLocalMediaEntry(id)
    expect(loaded?.filename).toBe("clip.mp4")
    expect(loaded?.mimeType).toBe("video/mp4")
    expect(loaded?.providerReady).toBe(false)

    await deleteLocalMediaEntry(id)
    expect(await getLocalMediaEntry(id)).toBeNull()
  })

  test("providerReady can be set by owner and cleared for owner", async () => {
    const id = crypto.randomUUID()
    await createLocalMediaEntry({
      id,
      roomId: "room-ready",
      ownerUserId: "owner-2",
      filename: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 100,
      providerReady: true,
    })

    expect((await getLocalMediaEntry(id))?.providerReady).toBe(true)

    const denied = await setLocalMediaProviderReady(id, false, {
      ownerUserId: "other",
    })
    expect(denied).toBeNull()
    expect((await getLocalMediaEntry(id))?.providerReady).toBe(true)

    await setLocalMediaProviderReady(id, false, { ownerUserId: "owner-2" })
    expect((await getLocalMediaEntry(id))?.providerReady).toBe(false)

    await setLocalMediaProviderReady(id, true, { ownerUserId: "owner-2" })
    await clearLocalMediaProviderReadyForOwner("room-ready", "owner-2")
    expect((await getLocalMediaEntry(id))?.providerReady).toBe(false)

    await deleteLocalMediaEntry(id)
  })
})
