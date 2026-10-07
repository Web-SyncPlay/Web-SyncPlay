import { describe, expect, test } from "bun:test"
import {
  localMediaInvalidRangeResponse,
  localMediaJsonError,
  parseLocalMediaRangeHeader,
} from "@/server/media/local-media-http"

describe("local-media-http helpers", () => {
  test("parses inclusive byte ranges and clamps the end", () => {
    expect(parseLocalMediaRangeHeader("bytes=0-99", 1000)).toEqual({
      start: 0,
      end: 99,
    })
    expect(parseLocalMediaRangeHeader("bytes=100-", 250)).toEqual({
      start: 100,
      end: 249,
    })
    expect(parseLocalMediaRangeHeader(null, 100)).toBeNull()
  })

  test("marks out-of-bounds ranges as invalid", () => {
    expect(parseLocalMediaRangeHeader("bytes=500-600", 100)).toEqual({
      invalid: true,
    })
    expect(parseLocalMediaRangeHeader("bytes=10-5", 100)).toEqual({
      invalid: true,
    })
  })

  test("builds stable JSON and 416 responses", async () => {
    const json = localMediaJsonError("not_found")
    expect(json.status).toBe(404)
    const body = await json.json()
    expect(body.code).toBe("not_found")

    const range = localMediaInvalidRangeResponse(2048)
    expect(range.status).toBe(416)
    expect(range.headers.get("content-range")).toBe("bytes */2048")
  })
})
