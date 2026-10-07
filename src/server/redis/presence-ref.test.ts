import { describe, expect, test } from "bun:test"
import {
  bumpPresenceNodeCount,
  encodePresenceNodeCounts,
  isPresentOnAliveNode,
  parsePresenceNodeCounts,
  totalPresenceRefs,
} from "./presence-ref"

describe("presence-ref", () => {
  test("treats legacy integer refcounts as orphaned", () => {
    expect(parsePresenceNodeCounts("1")).toEqual({})
    expect(parsePresenceNodeCounts("3")).toEqual({})
  })

  test("parses and encodes node maps", () => {
    const parsed = parsePresenceNodeCounts('{"node-a":2,"node-b":1}')
    expect(parsed).toEqual({ "node-a": 2, "node-b": 1 })
    expect(encodePresenceNodeCounts(parsed)).toBe('{"node-a":2,"node-b":1}')
    expect(totalPresenceRefs(parsed)).toBe(3)
  })

  test("bump and drop empty maps", () => {
    let counts = bumpPresenceNodeCount({}, "n1", 1)
    expect(encodePresenceNodeCounts(counts)).toBe('{"n1":1}')
    counts = bumpPresenceNodeCount(counts, "n1", -1)
    expect(encodePresenceNodeCounts(counts)).toBeNull()
  })

  test("alive-node filter ignores dead nodes", () => {
    const counts = { live: 1, dead: 2 }
    expect(isPresentOnAliveNode(counts, new Set(["live"]))).toBe(true)
    expect(isPresentOnAliveNode(counts, new Set(["other"]))).toBe(false)
  })
})
