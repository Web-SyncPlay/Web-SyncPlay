import { describe, expect, test } from "bun:test"
import {
  canControlFromConnectionContext,
  canManageRoomSecurityFromConnectionContext,
  computeSessionCapabilities,
} from "./permissions"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"

const state = createRoomState()

describe("permissions / session capabilities", () => {
  test("allows owner in room session", () => {
    expect(
      canControlFromConnectionContext(state, "owner", {
        isControlSession: false,
        controlAuthorized: false,
      }),
    ).toBe(true)
  })

  test("denies control session when identity verification failed", () => {
    expect(
      canControlFromConnectionContext(state, "owner", {
        isControlSession: true,
        controlAuthorized: false,
      }),
    ).toBe(false)
  })

  test("denies player embed session mutations", () => {
    expect(
      canControlFromConnectionContext(state, "owner", {
        isControlSession: false,
        controlAuthorized: true,
        sessionKind: "player",
      }),
    ).toBe(false)
  })

  test("room security is owner-only and session-gated", () => {
    expect(
      canManageRoomSecurityFromConnectionContext(state, "owner", {
        isControlSession: false,
        controlAuthorized: false,
        sessionKind: "room",
      }),
    ).toBe(true)
    expect(
      canManageRoomSecurityFromConnectionContext(state, "mod", {
        isControlSession: false,
        controlAuthorized: false,
        sessionKind: "room",
      }),
    ).toBe(false)
    expect(
      canManageRoomSecurityFromConnectionContext(state, "owner", {
        isControlSession: false,
        controlAuthorized: false,
        sessionKind: "player",
      }),
    ).toBe(false)
  })

  test("computeSessionCapabilities is the single source of truth", () => {
    expect(
      computeSessionCapabilities({
        role: "owner",
        sessionKind: "room",
        isControlSession: false,
        controlAuthorized: false,
      }),
    ).toEqual({
      canControlPlayback: true,
      canManagePlaylist: true,
      canManageRoomSecurity: true,
      isControlSession: false,
      controlAuthorized: false,
      sessionKind: "room",
    })

    expect(
      computeSessionCapabilities({
        role: "moderator",
        sessionKind: "control",
        isControlSession: true,
        controlAuthorized: true,
      }).canManageRoomSecurity,
    ).toBe(false)

    expect(
      computeSessionCapabilities({
        role: "guest",
        sessionKind: "room",
        isControlSession: false,
        controlAuthorized: false,
      }).canControlPlayback,
    ).toBe(false)
  })
})
