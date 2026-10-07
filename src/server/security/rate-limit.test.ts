import { describe, expect, test } from "bun:test"
import { clientIpFromRequest } from "./rate-limit"

describe("clientIpFromRequest", () => {
  test("uses first X-Forwarded-For hop", () => {
    const request = new Request("https://example.test/", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "10.0.0.2",
      },
    })
    expect(clientIpFromRequest(request)).toBe("203.0.113.10")
  })

  test("falls back to X-Real-IP then unknown", () => {
    expect(
      clientIpFromRequest(
        new Request("https://example.test/", {
          headers: { "x-real-ip": "198.51.100.1" },
        }),
      ),
    ).toBe("198.51.100.1")
    expect(clientIpFromRequest(new Request("https://example.test/"))).toBe(
      "unknown",
    )
  })
})
