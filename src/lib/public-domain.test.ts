import { describe, expect, test } from "bun:test"
import {
  buildContentSecurityPolicy,
  getPublicHostname,
  getPublicOrigin,
  isOriginAllowed,
  MEDIASOUP_RTC_UDP_PORT,
} from "@/lib/public-domain"

describe("public-domain", () => {
  test("hardcodes mediasoup UDP port", () => {
    expect(MEDIASOUP_RTC_UDP_PORT).toBe(40000)
  })

  test("derives hostname and https origin from bare domain", () => {
    const prev = process.env.PUBLIC_DOMAIN
    process.env.PUBLIC_DOMAIN = "web-syncplay.de"
    expect(getPublicHostname()).toBe("web-syncplay.de")
    expect(getPublicOrigin()).toBe("https://web-syncplay.de")
    expect(isOriginAllowed("https://web-syncplay.de")).toBe(true)
    expect(isOriginAllowed("https://evil.example")).toBe(false)
    process.env.PUBLIC_DOMAIN = prev
  })

  test("accepts full origin and strips for ICE hostname", () => {
    const prev = process.env.PUBLIC_DOMAIN
    process.env.PUBLIC_DOMAIN = "https://sync.example.com"
    expect(getPublicHostname()).toBe("sync.example.com")
    expect(getPublicOrigin()).toBe("https://sync.example.com")
    process.env.PUBLIC_DOMAIN = prev
  })

  test("CSP allows iframe embeds and remote media URLs", () => {
    const prev = process.env.PUBLIC_DOMAIN
    process.env.PUBLIC_DOMAIN = "web-syncplay.de"
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("frame-src 'self' https: http:")
    expect(csp).toContain("media-src 'self' blob: https: http:")
    expect(csp).toContain("https://www.youtube.com")
    expect(csp).toContain("https://www.youtube-nocookie.com")
    expect(csp).toContain("https://player.vimeo.com")
    expect(csp).toContain("img-src 'self' data: blob: https: http:")
    expect(csp).toContain("wss://web-syncplay.de")
    process.env.PUBLIC_DOMAIN = prev
  })

  test("localhost PUBLIC_DOMAIN uses http/ws origins", () => {
    const prev = process.env.PUBLIC_DOMAIN
    process.env.PUBLIC_DOMAIN = "localhost:3000"
    expect(getPublicOrigin()).toBe("http://localhost:3000")
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("ws://localhost:3000")
    process.env.PUBLIC_DOMAIN = prev
  })
})
