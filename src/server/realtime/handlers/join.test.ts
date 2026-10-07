import { describe, expect, test } from "bun:test"
import type { ParticipantState } from "@/zod/types"
import { resolveJoinParticipantProfile } from "./join"

describe("resolveJoinParticipantProfile", () => {
  test("keeps existing username/avatar for reconnecting participant", () => {
    const existingParticipant = {
      userId: "user-1",
      username: "Existing Name",
      avatarStyle: "avataaars",
      role: "guest",
      connected: false,
      joinedAt: 1,
      connectedAt: 1,
      disconnectedAt: 2,
      lastSeenAt: 2,
      localPlayback: {
        paused: true,
        currentTimeMs: 0,
        loading: false,
        updatedAt: 1,
      },
    } satisfies ParticipantState

    const profile = resolveJoinParticipantProfile(existingParticipant, {
      username: "Incoming Name",
      avatarStyle: "adventurer",
    })

    expect(profile).toEqual({
      username: "Existing Name",
      avatarStyle: "avataaars",
    })
  })

  test("uses incoming username/avatar for first-time join", () => {
    const profile = resolveJoinParticipantProfile(undefined, {
      username: "Incoming Name",
      avatarStyle: "adventurer",
    })

    expect(profile).toEqual({
      username: "Incoming Name",
      avatarStyle: "adventurer",
    })
  })
})
