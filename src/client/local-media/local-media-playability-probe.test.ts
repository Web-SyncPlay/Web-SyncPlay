import { describe, expect, test } from "bun:test"

import {
  formatFileSizeBytes,
  probeLocalFilePlayability,
} from "./local-media-playability-probe"

describe("formatFileSizeBytes", () => {
  test("formats common sizes", () => {
    expect(formatFileSizeBytes(0)).toBe("0 B")
    expect(formatFileSizeBytes(512)).toBe("512 B")
    expect(formatFileSizeBytes(2048)).toBe("2.0 KB")
    expect(formatFileSizeBytes(2 * 1024 * 1024)).toBe("2.0 MB")
  })
})

describe("probeLocalFilePlayability", () => {
  test("rejects empty files", async () => {
    const file = new File([], "empty.mp4", { type: "video/mp4" })
    const result = await probeLocalFilePlayability(file)
    expect(result.playable).toBe(false)
    if (!result.playable) {
      expect(result.failureReason).toBe("empty")
    }
  })

  test("rejects non-media types", async () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    const result = await probeLocalFilePlayability(file)
    expect(result.playable).toBe(false)
    if (!result.playable) {
      expect(result.failureReason).toBe("unsupported_type")
    }
  })
})
