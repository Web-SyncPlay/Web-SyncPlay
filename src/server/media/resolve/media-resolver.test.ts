import { describe, expect, test } from "bun:test"
import { resolveMediaSource } from "./media-resolver"

describe("resolveMediaSource progressive MPEG-TS", () => {
  test("rejects stream?container=m2ts with unsupported_format", async () => {
    const resolved = await resolveMediaSource({
      url: "https://jellyfin.example/Videos/abc/stream?api_key=k&container=m2ts",
      mintRelay: false,
    })
    expect(resolved.failureReason).toBe("unsupported_format")
    expect(resolved.resolveUserMessage).toMatch(/HLS/i)
    expect(resolved.mediaStreams).toEqual([])
  })

  test("rejects progressive .ts URLs", async () => {
    const resolved = await resolveMediaSource({
      url: "https://cdn.example/movie.ts",
      mintRelay: false,
    })
    expect(resolved.failureReason).toBe("unsupported_format")
  })
})
