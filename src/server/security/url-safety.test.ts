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
