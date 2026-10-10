import { describe, expect, test } from "bun:test"
import {
  canSetJoinCommitted,
  shouldAddPresenceOnJoin,
  shouldAppendParticipantJoinedLog,
} from "./membership-timing"

describe("join membership timing (R2/R3)", () => {
  test("shouldAddPresenceOnJoin skips when socket already tracks presence", () => {
    expect(shouldAddPresenceOnJoin(false)).toBe(true)
    expect(shouldAddPresenceOnJoin(true)).toBe(false)
  })

  test("canSetJoinCommitted requires open socket with registry meta (R3)", () => {
    expect(
      canSetJoinCommitted({
        readyState: 1,
        openState: 1,
        hasSocketMeta: true,
      }),
    ).toBe(true)
    expect(
      canSetJoinCommitted({
        readyState: 3,
        openState: 1,
        hasSocketMeta: true,
      }),
    ).toBe(false)
    expect(
      canSetJoinCommitted({
        readyState: 1,
        openState: 1,
        hasSocketMeta: false,
      }),
    ).toBe(false)
  })

  test("shouldAppendParticipantJoinedLog covers first join and reconnect", () => {
    expect(shouldAppendParticipantJoinedLog(false, undefined)).toBe(true)
    expect(shouldAppendParticipantJoinedLog(false, false)).toBe(true)
    expect(shouldAppendParticipantJoinedLog(true, false)).toBe(true)
    expect(shouldAppendParticipantJoinedLog(true, true)).toBe(false)
  })
})
