import { expect, test } from "bun:test"
import { isStaleUpstreamStatus } from "@/server/media/stale-upstream-refresh"

test("treats 401/403 as stale upstream", () => {
  expect(isStaleUpstreamStatus(401)).toBe(true)
  expect(isStaleUpstreamStatus(403)).toBe(true)
  expect(isStaleUpstreamStatus(404)).toBe(false)
  expect(isStaleUpstreamStatus(502)).toBe(false)
})
