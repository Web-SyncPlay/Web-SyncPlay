import { describe, expect, test } from "bun:test"
import {
  buildRoomJoinEnvelope,
  createDefaultSessionCapabilities,
  messageForJoinRejected,
  nextJoinStatusOnConnectAttempt,
  normalizeSessionCapabilities,
} from "./room-join-client"

describe("room-join-client", () => {
  test("createDefaultSessionCapabilities marks control sessions", () => {
    expect(createDefaultSessionCapabilities("room")).toEqual({
      canControlPlayback: false,
      canManagePlaylist: false,
      canManageRoomSecurity: false,
      isControlSession: false,
      controlAuthorized: false,
      sessionKind: "room",
    })
    expect(createDefaultSessionCapabilities("control").isControlSession).toBe(
      true,
    )
    expect(createDefaultSessionCapabilities("player").isControlSession).toBe(
      false,
    )
  })

  test("normalizeSessionCapabilities coerces flags and falls back sessionKind", () => {
    expect(
      normalizeSessionCapabilities(
        {
          canControlPlayback: 1 as unknown as boolean,
          canManagePlaylist: true,
          isControlSession: true,
          controlAuthorized: true,
        },
        "player",
      ),
    ).toEqual({
      canControlPlayback: true,
      canManagePlaylist: true,
      canManageRoomSecurity: false,
      isControlSession: true,
      controlAuthorized: true,
      sessionKind: "player",
    })
  })

  test("messageForJoinRejected distinguishes invalid password", () => {
    expect(messageForJoinRejected("invalid_password")).toContain("Incorrect")
    expect(messageForJoinRejected("password_required")).toContain(
      "join password",
    )
    expect(messageForJoinRejected("rate_limited")).toContain("join password")
    expect(messageForJoinRejected(undefined)).toContain("join password")
  })

  test("nextJoinStatusOnConnectAttempt preserves reconnecting after connected", () => {
    expect(nextJoinStatusOnConnectAttempt("connected")).toBe("reconnecting")
    expect(nextJoinStatusOnConnectAttempt("connecting")).toBe("connecting")
    expect(nextJoinStatusOnConnectAttempt("reconnecting")).toBe("connecting")
    expect(nextJoinStatusOnConnectAttempt("awaiting_password")).toBe(
      "connecting",
    )
  })

  test("buildRoomJoinEnvelope omits empty join password", () => {
    const envelope = buildRoomJoinEnvelope({
      roomId: "room-1",
      userId: "user-1",
      userSecret: "secret-1",
      username: "Alice",
      sessionKind: "room",
      joinPassword: "",
      requestId: "req-1",
    })
    expect(envelope.type).toBe("room:join")
    expect(envelope.requestId).toBe("req-1")
    expect(envelope.payload).toMatchObject({
      roomId: "room-1",
      userId: "user-1",
      username: "Alice",
      sessionKind: "room",
    })
    expect(envelope.payload).not.toHaveProperty("joinPassword")
  })
})
