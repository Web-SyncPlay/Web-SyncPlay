import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { parseOrWarn, redactPayloadForLog } from "./parse-or-warn"

describe("redactPayloadForLog", () => {
  test("redacts secret-looking keys nested in objects", () => {
    expect(
      redactPayloadForLog({
        roomSecurity: {
          joinPasswordHash: "abc",
          joinPasswordSalt: "def",
          joinPasswordEnabled: true,
        },
        viewerToken: "tok",
        title: "ok",
      }),
    ).toEqual({
      roomSecurity: {
        joinPasswordHash: "[redacted]",
        joinPasswordSalt: "[redacted]",
        joinPasswordEnabled: true,
      },
      viewerToken: "[redacted]",
      title: "ok",
    })
  })
})

describe("parseOrWarn", () => {
  test("returns parsed data on success", () => {
    const schema = z.object({ n: z.number() })
    expect(parseOrWarn(schema, { n: 1 }, "t")).toEqual({ n: 1 })
  })

  test("returns null on failure without throwing", () => {
    const schema = z.object({ n: z.number() })
    expect(parseOrWarn(schema, { n: "x" }, "t")).toBeNull()
  })
})
