import { afterEach, expect, test } from "bun:test"
import {
  resetRequestDedupeForTests,
  shouldSkipDuplicateRequest,
} from "./request-dedupe"

afterEach(() => {
  resetRequestDedupeForTests()
})

test("first requestId is accepted; immediate duplicate is skipped", () => {
  expect(shouldSkipDuplicateRequest("req-1")).toBe(false)
  expect(shouldSkipDuplicateRequest("req-1")).toBe(true)
})

test("distinct requestIds are both accepted", () => {
  expect(shouldSkipDuplicateRequest("req-a")).toBe(false)
  expect(shouldSkipDuplicateRequest("req-b")).toBe(false)
})
