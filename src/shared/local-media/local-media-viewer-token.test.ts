import { afterEach, describe, expect, test } from "bun:test"
import {
  clearLocalMediaViewerToken,
  loadLocalMediaViewerToken,
  persistLocalMediaViewerToken,
  withLocalMediaViewerToken,
} from "./local-media-viewer-token"

type MockStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

function createStorage(map: Map<string, string>): MockStorage {
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

afterEach(() => {
  clearLocalMediaViewerToken()
})

describe("local-media-viewer-token", () => {
  test("persists and appends vt/uid on local-media URLs", () => {
    const sessionMap = new Map<string, string>()
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: createStorage(sessionMap),
    })
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    })

    persistLocalMediaViewerToken({
      roomId: "room-1",
      userId: "user-1",
      token: "tok-abc",
    })

    expect(loadLocalMediaViewerToken()).toEqual({
      roomId: "room-1",
      userId: "user-1",
      token: "tok-abc",
    })
    expect(sessionMap.get("wsp.localMediaViewerToken")).toContain("tok-abc")

    expect(
      withLocalMediaViewerToken(
        "/api/media/local/00000000-0000-4000-8000-000000000001",
      ),
    ).toBe(
      "/api/media/local/00000000-0000-4000-8000-000000000001?vt=tok-abc&uid=user-1",
    )
    expect(withLocalMediaViewerToken("/api/media/local/m1/hls?x=1")).toBe(
      "/api/media/local/m1/hls?x=1&vt=tok-abc&uid=user-1",
    )
    expect(withLocalMediaViewerToken("https://cdn.example/a.mp4")).toBe(
      "https://cdn.example/a.mp4",
    )
    expect(withLocalMediaViewerToken("/api/media/local/internal/m1")).toBe(
      "/api/media/local/internal/m1",
    )
  })

  test("clear removes memory and sessionStorage", () => {
    const sessionMap = new Map<string, string>()
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: createStorage(sessionMap),
    })
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    })

    persistLocalMediaViewerToken({
      roomId: "room-1",
      userId: "user-1",
      token: "tok-abc",
    })
    clearLocalMediaViewerToken()
    expect(loadLocalMediaViewerToken()).toBeNull()
    expect(sessionMap.has("wsp.localMediaViewerToken")).toBe(false)
  })
})
