import { afterEach, describe, expect, test } from "bun:test"
import {
  clearLandingLocalMediaHandoff,
  peekLandingSkipDefaultMedia,
  stashLandingLocalMediaHandoff,
  takeLandingLocalMediaHandoff,
} from "./local-media-landing-handoff"

afterEach(() => {
  clearLandingLocalMediaHandoff()
})

describe("landing local media handoff", () => {
  test("stashes and consumes once for matching room id", () => {
    const file = new File(["abc"], "clip.mp4", { type: "video/mp4" })
    stashLandingLocalMediaHandoff("room-a", file)
    const first = takeLandingLocalMediaHandoff("room-a")
    expect(first?.file).toBe(file)
    expect(takeLandingLocalMediaHandoff("room-a")).toBeNull()
  })

  test("mismatched room id clears without returning", () => {
    const file = new File(["abc"], "clip.mp4", { type: "video/mp4" })
    stashLandingLocalMediaHandoff("room-a", file)
    expect(takeLandingLocalMediaHandoff("room-b")).toBeNull()
    expect(takeLandingLocalMediaHandoff("room-a")).toBeNull()
  })

  test("peekSkipDefaultMedia does not consume the File handoff", () => {
    const file = new File(["abc"], "clip.mp4", { type: "video/mp4" })
    stashLandingLocalMediaHandoff("room-a", file)
    expect(peekLandingSkipDefaultMedia("room-a")).toBe(true)
    expect(peekLandingSkipDefaultMedia("room-a")).toBe(true)
    expect(takeLandingLocalMediaHandoff("room-a")?.file).toBe(file)
    expect(peekLandingSkipDefaultMedia("room-a")).toBe(false)
  })
})
