import { describe, expect, test } from "bun:test"
import {
  httpStatusForLocalMediaError,
  localMediaErrorFromMessage,
  localMediaErrorMessage,
} from "@/lib/local-media-errors"

describe("local-media-errors", () => {
  test("maps provider timeout wording", () => {
    expect(localMediaErrorFromMessage("Local media provider timed out")).toBe(
      "provider_timeout",
    )
    expect(httpStatusForLocalMediaError("provider_timeout")).toBe(503)
    expect(localMediaErrorMessage("provider_timeout")).toContain("Timed out")
  })

  test("owner offline copy is actionable", () => {
    expect(localMediaErrorMessage("owner_offline")).toContain("offline")
    expect(localMediaErrorMessage("provider_unavailable")).toContain("share")
  })

  test("viewer capability denial is forbidden", () => {
    expect(httpStatusForLocalMediaError("viewer_capability_denied")).toBe(403)
    expect(localMediaErrorMessage("viewer_capability_denied")).toContain(
      "session",
    )
  })
})

