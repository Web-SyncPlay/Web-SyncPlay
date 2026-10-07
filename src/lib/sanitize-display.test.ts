import { describe, expect, test } from "bun:test"
import {
  isHttpOrHttpsUrl,
  sanitizeErrorMessage,
  sanitizeMediaTitle,
  sanitizeUsername,
} from "@/lib/sanitize-display"

describe("sanitizeUsername", () => {
  test("accepts plain names", () => {
    expect(sanitizeUsername("Ada Lovelace")).toBe("Ada Lovelace")
    expect(sanitizeUsername("  bob  ")).toBe("bob")
  })

  test("rejects HTML-packaged XSS payloads", () => {
    expect(sanitizeUsername("<script>alert(1)</script>")).toBeNull()
    expect(sanitizeUsername('<img src=x onerror=alert(1)>')).toBeNull()
    expect(sanitizeUsername('"><svg/onload=alert(1)>')).toBeNull()
  })

  test("rejects javascript:/data: packaging", () => {
    expect(sanitizeUsername("javascript:alert(1)")).toBeNull()
    expect(sanitizeUsername("data:text/html,<script>")).toBeNull()
  })

  test("strips controls and bidi overrides", () => {
    expect(sanitizeUsername("A\u0000da")).toBe("Ada")
    expect(sanitizeUsername("A\u202eda")).toBe("Ada")
  })
})

describe("sanitizeMediaTitle", () => {
  test("strips markup delimiters but keeps text", () => {
    expect(sanitizeMediaTitle("Song <Live>")).toBe("Song Live")
    expect(sanitizeMediaTitle('<script>x</script> track')).toBe("scriptx/script track")
  })

  test("caps length", () => {
    const long = "a".repeat(300)
    expect(sanitizeMediaTitle(long)?.length).toBe(256)
  })
})

describe("sanitizeErrorMessage", () => {
  test("rejects markup packaging", () => {
    expect(sanitizeErrorMessage("fail <b>now</b>")).toBeNull()
  })

  test("accepts plain errors", () => {
    expect(sanitizeErrorMessage("decode failed")).toBe("decode failed")
  })
})

describe("isHttpOrHttpsUrl", () => {
  test("allows http(s) only", () => {
    expect(isHttpOrHttpsUrl("https://cdn.example/a.vtt")).toBe(true)
    expect(isHttpOrHttpsUrl("javascript:alert(1)")).toBe(false)
    expect(isHttpOrHttpsUrl("data:text/html,hi")).toBe(false)
    expect(isHttpOrHttpsUrl("blob:https://x")).toBe(false)
  })
})
