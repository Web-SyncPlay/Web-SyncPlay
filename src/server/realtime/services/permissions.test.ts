import { describe, expect, test } from "bun:test"
import {
  canMutateByRole,
  canMutateFromClientSession,
  isClientControlAuthorized,
} from "@/lib/permissions-utils"
import {
  canControlFromConnectionContext,
  canManageRoomSecurityFromConnectionContext,
  computeSessionCapabilities,
  hasPlaybackAndPlaylistControl,
} from "./permissions"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"

const state = createRoomState()

describe("permissions / session capabilities", () => {
  test("role helpers agree on mutate eligibility", () => {
    expect(canMutateByRole("owner")).toBe(true)
    expect(canMutateByRole("moderator")).toBe(true)
    expect(canMutateByRole("guest")).toBe(false)
    expect(hasPlaybackAndPlaylistControl(state, "owner")).toBe(true)
    expect(hasPlaybackAndPlaylistControl(state, "guest")).toBe(false)
    expect(hasPlaybackAndPlaylistControl(state, "missing")).toBe(false)
  })

  test("client session helpers mirror embed UI gates", () => {
    expect(
      isClientControlAuthorized({
        isControlSession: false,
        controlAuthorized: false,
      }),
    ).toBe(true)
    expect(
      isClientControlAuthorized({
        isControlSession: true,
        controlAuthorized: false,
      }),
    ).toBe(false)
    expect(
      canMutateFromClientSession({
        role: "owner",
        isControlSession: true,
        controlAuthorized: true,
      }),
    ).toBe(true)
    expect(
      canMutateFromClientSession({
        role: "guest",
        isControlSession: false,
        controlAuthorized: false,
      }),
    ).toBe(false)
  })

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
