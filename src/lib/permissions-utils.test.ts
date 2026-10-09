import { describe, expect, test } from "bun:test"
import {
  canControlPlayback,
  canControlPlaylist,
  canMutateByRole,
  canMutateFromClientSession,
  isClientControlAuthorized,
  isOwner,
} from "@/lib/permissions-utils"

describe("permissions-utils (client gates)", () => {
  test("role helpers", () => {
    expect(isOwner("owner")).toBe(true)
    expect(isOwner("moderator")).toBe(false)
    expect(canMutateByRole("owner")).toBe(true)
    expect(canMutateByRole("moderator")).toBe(true)
    expect(canMutateByRole("guest")).toBe(false)
    expect(canControlPlayback("moderator")).toBe(true)
    expect(canControlPlaylist("guest")).toBe(false)
  })

  test("control session authorization", () => {
    expect(
      isClientControlAuthorized({
        isControlSession: false,
        controlAuthorized: false,
      }),
    ).toBe(true)
    expect(
      isClientControlAuthorized({
        isControlSession: true,
        controlAuthorized: true,
      }),
    ).toBe(true)
    expect(
      isClientControlAuthorized({
        isControlSession: true,
        controlAuthorized: false,
      }),
    ).toBe(false)
  })

  test("canMutateFromClientSession blocks OBS player embeds", () => {
    expect(
      canMutateFromClientSession({
        role: "owner",
        isControlSession: false,
        controlAuthorized: false,
        sessionKind: "player",
      }),
    ).toBe(false)
    expect(
      canMutateFromClientSession({
        role: "owner",
        isControlSession: false,
        controlAuthorized: false,
        sessionKind: "room",
      }),
    ).toBe(true)
    expect(
      canMutateFromClientSession({
        role: "owner",
        isControlSession: true,
        controlAuthorized: false,
        sessionKind: "control",
      }),
    ).toBe(false)
  })
})
