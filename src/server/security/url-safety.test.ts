import { expect, test } from "bun:test"
import {
  assertPublicHttpUrl,
  assertPublicHttpUrlResolved,
} from "./url-safety"

test("allows public https URLs", () => {
  const result = assertPublicHttpUrl("https://cdn.example.com/video.mp4")
  expect(result.ok).toBe(true)
})

test("blocks localhost and private IPs", () => {
  expect(assertPublicHttpUrl("http://localhost/x").ok).toBe(false)
  expect(assertPublicHttpUrl("http://127.0.0.1/x").ok).toBe(false)
  expect(assertPublicHttpUrl("http://10.0.0.5/x").ok).toBe(false)
  expect(assertPublicHttpUrl("http://192.168.1.1/x").ok).toBe(false)
  expect(assertPublicHttpUrl("file:///etc/passwd").ok).toBe(false)
})

test("blocks trailing-dot and IPv4-mapped IPv6 SSRF bypasses", () => {
  expect(assertPublicHttpUrl("http://localhost./").ok).toBe(false)
  expect(assertPublicHttpUrl("http://metadata.google.internal./").ok).toBe(
    false,
  )
  expect(assertPublicHttpUrl("http://foo.localhost./").ok).toBe(false)
  expect(assertPublicHttpUrl("http://[::ffff:127.0.0.1]/").ok).toBe(false)
  expect(assertPublicHttpUrl("http://[::ffff:7f00:1]/").ok).toBe(false)
  expect(assertPublicHttpUrl("http://[0:0:0:0:0:ffff:127.0.0.1]/").ok).toBe(
    false,
  )
  expect(assertPublicHttpUrl("http://[::ffff:169.254.169.254]/").ok).toBe(
    false,
  )
  expect(assertPublicHttpUrl("http://0x7f000001/").ok).toBe(false)
  expect(assertPublicHttpUrl("http://2130706433/").ok).toBe(false)
})

test("resolved check rejects hostname that DNSes to a private IP", async () => {
  const result = await assertPublicHttpUrlResolved(
    "https://evil.example.com/video.mp4",
    { lookup: async () => ["10.0.0.5"] },
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toBe("private_ip")
})

test("resolved check rejects when any address is private", async () => {
  const result = await assertPublicHttpUrlResolved(
    "https://dual.example.com/x",
    { lookup: async () => ["93.184.216.34", "169.254.169.254"] },
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.reason).toBe("private_ip")
})

test("resolved check rejects link-local and unique-local IPv6", async () => {
  const linkLocal = await assertPublicHttpUrlResolved(
    "https://v6.example.com/x",
    { lookup: async () => ["fe80::1"] },
  )
  expect(linkLocal.ok).toBe(false)

  const uniqueLocal = await assertPublicHttpUrlResolved(
    "https://v6.example.com/x",
    { lookup: async () => ["fd12::1"] },
  )
  expect(uniqueLocal.ok).toBe(false)
})

test("resolved check allows hostname that DNSes only to public IPs", async () => {
  const result = await assertPublicHttpUrlResolved(
    "https://cdn.example.com/video.mp4",
    { lookup: async () => ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"] },
  )
  expect(result.ok).toBe(true)
})

test("resolved check fails closed on DNS errors and empty answers", async () => {
  const failed = await assertPublicHttpUrlResolved(
    "https://missing.example.com/x",
    {
      lookup: async () => {
        throw new Error("ENOTFOUND")
      },
    },
  )
  expect(failed.ok).toBe(false)
  if (!failed.ok) expect(failed.reason).toBe("dns_lookup_failed")

  const empty = await assertPublicHttpUrlResolved(
    "https://empty.example.com/x",
    { lookup: async () => [] },
  )
  expect(empty.ok).toBe(false)
  if (!empty.ok) expect(empty.reason).toBe("dns_lookup_failed")
})

test("resolved check skips DNS for IP literals already validated sync", async () => {
  let lookedUp = false
  const result = await assertPublicHttpUrlResolved("https://93.184.216.34/x", {
    lookup: async () => {
      lookedUp = true
      return ["10.0.0.1"]
    },
  })
  expect(result.ok).toBe(true)
  expect(lookedUp).toBe(false)
})
