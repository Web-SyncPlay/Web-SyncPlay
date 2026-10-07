import { expect, test } from "bun:test"
import fc from "fast-check"
import { assertPublicHttpUrl } from "./url-safety"

const privateIpv4 = fc
  .oneof(
    fc.tuple(
      fc.constant(10),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
    fc.tuple(
      fc.constant(127),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
    fc.tuple(
      fc.constant(192),
      fc.constant(168),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
    fc.tuple(
      fc.constant(169),
      fc.constant(254),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
    fc.tuple(
      fc.constant(172),
      fc.integer({ min: 16, max: 31 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
    fc.tuple(
      fc.constant(100),
      fc.integer({ min: 64, max: 127 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
    fc.tuple(
      fc.constant(0),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
      fc.integer({ min: 0, max: 255 }),
    ),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)

const publicIpv4 = fc
  .tuple(
    fc.integer({ min: 1, max: 223 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 1, max: 254 }),
  )
  .filter(([a, b]) => {
    if (a === 10 || a === 127) return false
    if (a === 0) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && b === 168) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    return true
  })
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`)

// Letters-only labels avoid incomplete punycode (`xn--…`) that WHATWG rejects.
const dnsLabel = fc.stringMatching(/^[a-z]{1,10}$/)

const publicHostname = fc
  .tuple(dnsLabel, dnsLabel)
  .map(([a, b]) => `${a}.${b}`)
  .filter(
    (host) =>
      host !== "localhost" &&
      host !== "metadata" &&
      !host.endsWith(".localhost") &&
      !host.endsWith(".local") &&
      host !== "metadata.google.internal",
  )

test("assertPublicHttpUrl never throws on arbitrary strings", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 200 }), (raw) => {
      const result = assertPublicHttpUrl(raw)
      expect(typeof result.ok).toBe("boolean")
      if (!result.ok) {
        expect(typeof result.reason).toBe("string")
      }
    }),
    { numRuns: 100 },
  )
})

test("private IPv4 literals are always rejected", () => {
  fc.assert(
    fc.property(
      privateIpv4,
      fc.constantFrom("http", "https"),
      fc.stringMatching(/^\/[a-z0-9/-]{0,40}$/),
      (ip, scheme, path) => {
        const result = assertPublicHttpUrl(`${scheme}://${ip}${path}`)
        expect(result.ok).toBe(false)
      },
    ),
    { numRuns: 80 },
  )
})

test("blocked hostnames are always rejected", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        "localhost",
        "metadata",
        "metadata.google.internal",
        "foo.localhost",
        "bar.local",
      ),
      fc.constantFrom("http", "https"),
      fc.constantFrom("", "."),
      (host, scheme, trailingDot) => {
        expect(
          assertPublicHttpUrl(`${scheme}://${host}${trailingDot}/x`).ok,
        ).toBe(false)
      },
    ),
    { numRuns: 40 },
  )
})

test("IPv4-mapped IPv6 forms of private IPv4 are rejected", () => {
  fc.assert(
    fc.property(privateIpv4, fc.constantFrom("http", "https"), (ip, scheme) => {
      const forms = [
        `${scheme}://[::ffff:${ip}]/`,
        `${scheme}://[0:0:0:0:0:ffff:${ip}]/`,
      ]
      for (const url of forms) {
        expect(assertPublicHttpUrl(url).ok).toBe(false)
      }
    }),
    { numRuns: 80 },
  )
})

test("non-http(s) schemes are rejected when the URL parses", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("ftp", "ws", "wss"),
      publicHostname,
      (scheme, host) => {
        const result = assertPublicHttpUrl(`${scheme}://${host}/x`)
        expect(result.ok).toBe(false)
        if (result.ok === false) {
          expect(
            result.reason === "unsupported_protocol" ||
              result.reason === "invalid_url",
          ).toBe(true)
        }
      },
    ),
    { numRuns: 40 },
  )
})

test("public https hosts and public IPv4 are accepted", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        publicHostname.map((h) => `https://${h}/media.mp4`),
        publicIpv4.map((ip) => `https://${ip}/media.mp4`),
      ),
      (url) => {
        expect(assertPublicHttpUrl(url).ok).toBe(true)
      },
    ),
    { numRuns: 80 },
  )
})
