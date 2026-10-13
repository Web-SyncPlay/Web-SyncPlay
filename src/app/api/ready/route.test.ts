import { markProcessDraining, resetLifecycleForTests } from "@/server/lifecycle"
import { afterEach, describe, expect, mock, test } from "bun:test"

afterEach(() => {
  mock.restore()
  resetLifecycleForTests({ exitProcess: false })
})

describe("GET /api/ready", () => {
  test("503 when draining even if Valkey is up", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        ping: async () => "PONG",
      }),
    }))
    markProcessDraining()

    const { GET } = await import("./route")
    const response = await GET()
    expect(response.status).toBe(503)
    const body = (await response.json()) as {
      ready: boolean
      draining: boolean
    }
    expect(body.ready).toBe(false)
    expect(body.draining).toBe(true)
  })

  test("200 when Valkey up and not draining", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => ({
        ping: async () => "PONG",
      }),
    }))

    const { GET } = await import("./route")
    const response = await GET()
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ready: boolean
      draining: boolean
      valkey: boolean
    }
    expect(body.ready).toBe(true)
    expect(body.draining).toBe(false)
    expect(body.valkey).toBe(true)
  })

  test("503 when Valkey down", async () => {
    mock.module("@/server/redis/client", () => ({
      getCommandClient: async () => {
        throw new Error("no valkey")
      },
    }))

    const { GET } = await import("./route")
    const response = await GET()
    expect(response.status).toBe(503)
    const body = (await response.json()) as { ready: boolean; valkey: boolean }
    expect(body.ready).toBe(false)
    expect(body.valkey).toBe(false)
  })
})
