import { describe, expect, test } from "bun:test"
import {
  arrayBufferToBase64,
  getLocalMediaFile,
  getLocalMediaObjectUrl,
  registerLocalMediaFile,
  unregisterLocalMediaFile,
} from "@/lib/local-media-provider"

describe("local-media-provider", () => {
  test("keeps File reference and derives object URL", () => {
    const id = crypto.randomUUID()
    const file = new File([new Uint8Array([1, 2, 3, 4])], "a.mp4", {
      type: "video/mp4",
    })
    registerLocalMediaFile(id, file)
    expect(getLocalMediaFile(id)).toBe(file)
    const url = getLocalMediaObjectUrl(id)
    expect(url?.startsWith("blob:")).toBe(true)
    expect(getLocalMediaObjectUrl(id)).toBe(url)
    unregisterLocalMediaFile(id)
    expect(getLocalMediaFile(id)).toBeNull()
  })

  test("arrayBufferToBase64 round-trips small payloads", () => {
    const bytes = new Uint8Array([72, 105])
    const b64 = arrayBufferToBase64(bytes.buffer)
    expect(b64).toBe(btoa("Hi"))
  })
})
