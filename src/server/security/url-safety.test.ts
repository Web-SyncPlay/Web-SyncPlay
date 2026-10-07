import { expect, test } from "bun:test"
import { assertPublicHttpUrl } from "./url-safety"

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
