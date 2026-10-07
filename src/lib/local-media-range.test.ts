import { describe, expect, test } from "bun:test"
import {
  parseLocalMediaRangeHeader,
  parseRawBytesRangeHeader,
  resolveBytesRangeAgainstLength,
} from "./local-media-range"

describe("local-media-range", () => {
  test("parseRawBytesRangeHeader keeps open-ended ends as null", () => {
    expect(parseRawBytesRangeHeader("bytes=0-99")).toEqual({
      start: 0,
      end: 99,
    })
    expect(parseRawBytesRangeHeader("bytes=100-")).toEqual({
      start: 100,
      end: null,
    })
    expect(parseRawBytesRangeHeader(null)).toBeNull()
    expect(parseRawBytesRangeHeader("bytes=abc")).toBeNull()
  })

  test("resolveBytesRangeAgainstLength clamps and marks invalid", () => {
    expect(
      resolveBytesRangeAgainstLength({ start: 100, end: null }, 250),
    ).toEqual({ start: 100, end: 249 })
    expect(
      resolveBytesRangeAgainstLength({ start: 500, end: 600 }, 100),
    ).toEqual({ invalid: true })
    expect(
      resolveBytesRangeAgainstLength({ start: 10, end: 5 }, 100),
    ).toEqual({ invalid: true })
  })

  test("parseLocalMediaRangeHeader matches HTTP helper semantics", () => {
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
})
