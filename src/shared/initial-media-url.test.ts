import { describe, expect, test } from "bun:test"
import { parseInitialMediaUrl, readMediaQueryParam } from "./initial-media-url"

describe("readMediaQueryParam", () => {
  test("returns trimmed first value", () => {
    expect(readMediaQueryParam("  https://a.example/x  ")).toBe(
      "https://a.example/x",
    )
    expect(readMediaQueryParam(["ftp://bad", "https://ok"])).toBe("ftp://bad")
    expect(readMediaQueryParam("   ")).toBeUndefined()
    expect(readMediaQueryParam(undefined)).toBeUndefined()
  })
})

describe("parseInitialMediaUrl", () => {
  test("accepts http(s) URLs", () => {
    expect(parseInitialMediaUrl("https://youtu.be/abc")).toBe(
      "https://youtu.be/abc",
    )
    expect(parseInitialMediaUrl("http://example.com/a.mp4")).toBe(
      "http://example.com/a.mp4",
    )
  })

  test("rejects non-http schemes and invalid input", () => {
    expect(parseInitialMediaUrl("javascript:alert(1)")).toBeUndefined()
    expect(parseInitialMediaUrl("ftp://example.com/a")).toBeUndefined()
    expect(parseInitialMediaUrl("not a url")).toBeUndefined()
    expect(parseInitialMediaUrl(undefined)).toBeUndefined()
    expect(parseInitialMediaUrl("")).toBeUndefined()
  })

  test("uses the first value when given an array", () => {
    expect(
      parseInitialMediaUrl(["https://a.example/x", "https://b.example/y"]),
    ).toBe("https://a.example/x")
  })
})
