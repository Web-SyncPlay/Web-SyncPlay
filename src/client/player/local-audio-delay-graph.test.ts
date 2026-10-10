import { afterEach, describe, expect, test } from "bun:test"

import { attachLocalAudioDelayGraph } from "./local-audio-delay-graph"

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe("attachLocalAudioDelayGraph", () => {
  test("returns null when AudioContext is unavailable", () => {
    ;(globalThis as { window?: unknown }).window = {}
    const media = {
      // Minimal stand-in; attach should fail the capability check first.
    } as HTMLMediaElement
    expect(attachLocalAudioDelayGraph(media, 100)).toBeNull()
  })

  test("returns null instead of throwing when createMediaElementSource fails", () => {
    class FakeAudioContext {
      state = "running"
      sampleRate = 48_000
      createMediaElementSource() {
        throw new Error("already connected")
      }
      createDelay() {
        return {
          delayTime: { setValueAtTime() {} },
          connect() {},
          disconnect() {},
        }
      }
      createScriptProcessor() {
        return {
          connect() {},
          disconnect() {},
          onaudioprocess: null,
        }
      }
      resume() {
        return Promise.resolve()
      }
      close() {
        return Promise.resolve()
      }
    }

    ;(globalThis as { window?: unknown }).window = {
      AudioContext: FakeAudioContext,
    }

    const media = {} as HTMLMediaElement
    expect(attachLocalAudioDelayGraph(media, 50)).toBeNull()
  })
})
