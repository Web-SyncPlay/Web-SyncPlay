import { afterEach, expect, test } from "bun:test"
import {
  acaoAllowsBrowserPlayback,
  probeCorsPlayback,
} from "@/server/media/cors/cors-probe"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("ACAO must be * or exact origin", () => {
  expect(acaoAllowsBrowserPlayback("*")).toBe(true)
  expect(
    acaoAllowsBrowserPlayback("https://playback.web-syncplay.local"),
  ).toBe(true)
  expect(acaoAllowsBrowserPlayback("https://evil.example")).toBe(false)
  expect(acaoAllowsBrowserPlayback("null")).toBe(false)
  expect(acaoAllowsBrowserPlayback(null)).toBe(false)
  // Former loose check matched any header containing "http".
  expect(acaoAllowsBrowserPlayback("https://cdn.example")).toBe(false)
})

test("falls back to GET Range when HEAD is 405", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase()
    calls.push(method)
    if (method === "HEAD") {
      return new Response(null, { status: 405 })
    }
    return new Response(new Uint8Array([0, 1]), {
      status: 206,
      headers: {
        "access-control-allow-origin": "*",
        "content-type": "video/mp4",
      },
    })
  }) as typeof fetch

  await expect(probeCorsPlayback("https://cdn.example/v.mp4")).resolves.toBe(
    true,
  )
  expect(calls).toEqual(["HEAD", "GET"])
})

test("HEAD with usable ACAO short-circuits without GET", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push((init?.method ?? "GET").toUpperCase())
    return new Response(null, {
      status: 200,
      headers: { "access-control-allow-origin": "*" },
    })
  }) as typeof fetch

  await expect(probeCorsPlayback("https://cdn.example/v.mp4")).resolves.toBe(
    true,
  )
  expect(calls).toEqual(["HEAD"])
})

test("HEAD without ACAO falls back to GET before denying", async () => {
  const calls: string[] = []
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase()
    calls.push(method)
    if (method === "HEAD") {
      return new Response(null, { status: 200 })
    }
    return new Response(new Uint8Array([0]), {
      status: 206,
      headers: { "access-control-allow-origin": "*" },
    })
  }) as typeof fetch

  await expect(probeCorsPlayback("https://cdn.example/v.mp4")).resolves.toBe(
    true,
  )
  expect(calls).toEqual(["HEAD", "GET"])
})
