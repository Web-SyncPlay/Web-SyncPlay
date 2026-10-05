import assert from "node:assert/strict"
import test from "node:test"
import { assertPublicHttpUrl } from "./url-safety"

test("allows public https URLs", () => {
  const result = assertPublicHttpUrl("https://cdn.example.com/video.mp4")
  assert.equal(result.ok, true)
})

test("blocks localhost and private IPs", () => {
  assert.equal(assertPublicHttpUrl("http://localhost/x").ok, false)
  assert.equal(assertPublicHttpUrl("http://127.0.0.1/x").ok, false)
  assert.equal(assertPublicHttpUrl("http://10.0.0.5/x").ok, false)
  assert.equal(assertPublicHttpUrl("http://192.168.1.1/x").ok, false)
  assert.equal(assertPublicHttpUrl("file:///etc/passwd").ok, false)
})
