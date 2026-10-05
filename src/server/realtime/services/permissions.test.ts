import { expect, test } from "bun:test"
import { canControlFromConnectionContext } from "./permissions"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"

const state = createRoomState()

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
