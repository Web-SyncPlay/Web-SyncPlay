import { describe, expect, mock, test } from "bun:test"

mock.module("@/server/realtime/services/control-token", () => ({
  validateControlToken: async (input: {
    token: string
    roomId: string
    userId: string
  }) =>
    input.token === "good-token" &&
    input.roomId === "room-1" &&
    input.userId === "user-1",
}))

const { authorizeControlSession } = await import("./control-auth")

describe("authorizeControlSession", () => {
  test("non-control sessions are never authorized", async () => {
    expect(
      await authorizeControlSession({
        sessionKind: "room",
        controlToken: "good-token",
        roomId: "room-1",
        userId: "user-1",
      }),
    ).toEqual({ isControlSession: false, controlAuthorized: false })

    expect(
      await authorizeControlSession({
        sessionKind: "player",
        controlToken: undefined,
        roomId: "room-1",
        userId: "user-1",
      }),
    ).toEqual({ isControlSession: false, controlAuthorized: false })
  })

  test("control session authorizes with valid token", async () => {
    expect(
      await authorizeControlSession({
        sessionKind: "control",
        controlToken: "good-token",
        roomId: "room-1",
        userId: "user-1",
      }),
    ).toEqual({ isControlSession: true, controlAuthorized: true })
  })

  test("control session is unauthorized without a valid token", async () => {
    expect(
      await authorizeControlSession({
        sessionKind: "control",
        controlToken: "bad-token",
        roomId: "room-1",
        userId: "user-1",
      }),
    ).toEqual({ isControlSession: true, controlAuthorized: false })

    expect(
      await authorizeControlSession({
        sessionKind: "control",
        controlToken: undefined,
        roomId: "room-1",
        userId: "user-1",
      }),
    ).toEqual({ isControlSession: true, controlAuthorized: false })
  })
})
