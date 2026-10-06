import { describe, expect, test } from "bun:test"
import {
  announceLocalMediaProviderReady,
  arrayBufferToBase64,
  getLocalMediaFile,
  getLocalMediaObjectUrl,
  listLocalMediaIds,
  registerLocalMediaFile,
  unregisterLocalMediaFile,
} from "@/lib/local-media-provider"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type { RoomState } from "@/zod/types"

describe("local-media-provider", () => {
  test("keeps File reference and derives object URL", () => {
    const id = crypto.randomUUID()
    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.mp4", {
      type: "video/mp4",
    })
    registerLocalMediaFile(id, file)
    expect(getLocalMediaFile(id)).toBe(file)
    expect(listLocalMediaIds()).toContain(id)
    const url = getLocalMediaObjectUrl(id)
    expect(url?.startsWith("blob:")).toBe(true)
    expect(getLocalMediaObjectUrl(id)).toBe(url)
    unregisterLocalMediaFile(id)
    expect(getLocalMediaFile(id)).toBeNull()
  })

  test("announceLocalMediaProviderReady reports held and missing files", () => {
    const heldId = crypto.randomUUID()
    const missingId = crypto.randomUUID()
    const file = new File([new Uint8Array([1])], "a.mp4", { type: "video/mp4" })
    registerLocalMediaFile(heldId, file)

    const sent: Array<{ type: string; payload: unknown }> = []
    const send: TypedRoomEventSender = (type, payload) => {
      sent.push({ type, payload })
    }
    const roomState = {
      playlist: [
        {
          sourceKind: "local_file",
          localMediaId: heldId,
          localOriginUserId: "user-1",
        },
        {
          sourceKind: "local_file",
          localMediaId: missingId,
          localOriginUserId: "user-1",
        },
        {
          sourceKind: "local_file",
          localMediaId: crypto.randomUUID(),
          localOriginUserId: "other",
        },
      ],
    } as unknown as RoomState

    announceLocalMediaProviderReady(send, roomState, "user-1")

    expect(sent).toContainEqual({
      type: "local-media:ready",
      payload: { localMediaId: heldId, ready: true },
    })
    expect(sent).toContainEqual({
      type: "local-media:ready",
      payload: { localMediaId: missingId, ready: false },
    })
    expect(sent.length).toBe(2)

    unregisterLocalMediaFile(heldId)
  })

  test("arrayBufferToBase64 round-trips small payloads", () => {
    const bytes = new Uint8Array([72, 105])
    const b64 = arrayBufferToBase64(bytes.buffer)
    expect(b64).toBe(btoa("Hi"))
  })
})
