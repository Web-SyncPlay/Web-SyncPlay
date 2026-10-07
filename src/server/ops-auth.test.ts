import { beforeEach, describe, expect, mock, test } from "bun:test"

const envState = {
  OPS_SECRET: undefined as string | undefined,
  NODE_ENV: "development" as string,
}

mock.module("@/env", () => ({
  env: envState,
}))

const { assertOpsAuthorized, withOpsAuth } = await import("./ops-auth")

describe("ops-auth", () => {
  beforeEach(() => {
    envState.OPS_SECRET = undefined
    envState.NODE_ENV = "development"
  })

  test("allows unset secret outside production", () => {
    expect(assertOpsAuthorized(new Request("https://example.test/"))).toBeNull()
  })

  test("rejects unset secret in production", async () => {
    envState.NODE_ENV = "production"
    const denied = assertOpsAuthorized(new Request("https://example.test/"))
    expect(denied?.status).toBe(503)
  })

  test("accepts bearer and x-ops-secret when configured", async () => {
    envState.OPS_SECRET = "ops-secret-value"
    expect(
      assertOpsAuthorized(
        new Request("https://example.test/", {
          headers: { authorization: "Bearer ops-secret-value" },
        }),
      ),
    ).toBeNull()
    expect(
      assertOpsAuthorized(
        new Request("https://example.test/", {
          headers: { "x-ops-secret": "ops-secret-value" },
        }),
      ),
    ).toBeNull()

    const denied = assertOpsAuthorized(
      new Request("https://example.test/", {
        headers: { authorization: "Bearer wrong-secret" },
      }),
    )
    expect(denied?.status).toBe(401)
  })

  test("withOpsAuth short-circuits on denial", async () => {
    envState.OPS_SECRET = "ops-secret-value"
    let ran = false
    const response = await withOpsAuth(new Request("https://example.test/"), async () => {
      ran = true
      return Response.json({ ok: true })
    })
    expect(ran).toBe(false)
    expect(response.status).toBe(401)
  })
})
