import { describe, expect, test } from "bun:test"
import {
  buildRoomJoinEnvelope,
  createDefaultSessionCapabilities,
  isTerminalJoinRejection,
  messageForJoinRejected,
  nextJoinStatusOnConnectAttempt,
  normalizeSessionCapabilities,
  shouldPauseAutoReconnect,
  statusForJoinRejected,
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
    expect(createDefaultSessionCapabilities("embed")).toMatchObject({
      isControlSession: false,
      sessionKind: "embed",
      canControlPlayback: false,
    })
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
    expect(messageForJoinRejected("rate_limited")).toContain("Too many")
    expect(messageForJoinRejected("identity_mismatch")).toContain(
      "identity",
    )
    expect(messageForJoinRejected("media_url_unsupported")).toContain(
      "not supported",
    )
    expect(messageForJoinRejected("connection_closed")).toContain(
      "Connection closed",
    )
    expect(messageForJoinRejected(undefined)).toContain("join password")
  })

  test("statusForJoinRejected maps dedicated statuses (not awaiting_password)", () => {
    expect(statusForJoinRejected("media_url_unsupported")).toBe(
      "media_unsupported",
    )
    expect(statusForJoinRejected("rate_limited")).toBe("rate_limited")
    expect(statusForJoinRejected("identity_mismatch")).toBe(
      "identity_mismatch",
    )
    expect(statusForJoinRejected("connection_closed")).toBe("reconnecting")
    expect(statusForJoinRejected("password_required")).toBe(
      "awaiting_password",
    )
    expect(statusForJoinRejected("invalid_password")).toBe("awaiting_password")
  })

  test("shouldPauseAutoReconnect covers password, rate limit, and terminal reasons", () => {
    expect(shouldPauseAutoReconnect("password_required")).toBe(true)
    expect(shouldPauseAutoReconnect("invalid_password")).toBe(true)
    expect(shouldPauseAutoReconnect("rate_limited")).toBe(true)
    expect(shouldPauseAutoReconnect("identity_mismatch")).toBe(true)
    expect(shouldPauseAutoReconnect("media_url_unsupported")).toBe(true)
    expect(shouldPauseAutoReconnect("connection_closed")).toBe(false)
    expect(shouldPauseAutoReconnect(undefined)).toBe(true)
    expect(isTerminalJoinRejection("identity_mismatch")).toBe(true)
    expect(isTerminalJoinRejection("media_url_unsupported")).toBe(true)
    expect(isTerminalJoinRejection("rate_limited")).toBe(false)
    expect(isTerminalJoinRejection("password_required")).toBe(false)
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

  test("buildRoomJoinEnvelope includes embed sessionKind and initialMediaUrl", () => {
    const envelope = buildRoomJoinEnvelope({
      roomId: "party-1",
      userId: "user-1",
      userSecret: "secret-1",
      username: "Host",
      sessionKind: "embed",
      initialMediaUrl: "https://youtu.be/abc",
    })
    expect(envelope.payload).toMatchObject({
      sessionKind: "embed",
      initialMediaUrl: "https://youtu.be/abc",
    })
  })
})
