import { describe, expect, test } from "bun:test"
import { keys } from "./keys"

describe("redis keys", () => {
  test("room state key round-trip and scan pattern", () => {
    expect(keys.roomState("abc")).toBe("room:abc:state")
    expect(keys.roomStateScanPattern()).toBe("room:*:state")
    expect(keys.parseRoomStateKey("room:abc:state")).toBe("abc")
    expect(keys.parseRoomStateKey("room:foo:bar:state")).toBe("foo:bar")
    expect(keys.parseRoomStateKey("room:abc:channel")).toBe("")
    expect(keys.parseRoomStateKey("other:abc:state")).toBe("")
  })

  test("legacy channel and typed channel parsers share prefix rules", () => {
    expect(keys.roomChannel("r1")).toBe("room:r1:channel")
    expect(keys.parseRoomChannel("room:r1:channel")).toBe("r1")
    expect(keys.parseRoomChannel("room:r1:control")).toBe("")

    expect(keys.parseRoomTypedChannel("room:r1:control", ":control")).toBe("r1")
    expect(keys.parseRoomTypedChannel("room:r1:presence", ":presence")).toBe(
      "r1",
    )
    expect(keys.parseRoomTypedChannel("room:r1:snapshot", ":snapshot")).toBe(
      "r1",
    )
    expect(keys.parseRoomTypedChannel("room:r1:control", ":presence")).toBe("")
  })

  test("presence / identity / defaults key shapes are stable", () => {
    expect(keys.roomPresenceRef("r")).toBe("room:r:presenceRef")
    expect(keys.roomPresenceData("r")).toBe("room:r:presenceData")
    expect(keys.roomIdentity("r")).toBe("room:r:identity")
    expect(keys.roomViewerCapability("r", "u1")).toBe("room:r:viewer:u1")
    expect(keys.dailyDefaults()).toBe("defaults:daily-top-10")
    expect(keys.appNodeAlive("nid")).toBe("app:node:nid:alive")
    expect(keys.appNodeAliveScanPattern()).toBe("app:node:*:alive")
  })
})

