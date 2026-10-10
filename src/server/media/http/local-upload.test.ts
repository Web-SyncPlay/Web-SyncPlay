import { describe, expect, test } from "bun:test"
import { handleLocalMediaUploadDisabled } from "@/server/media/http/local-upload"

describe("media http local-upload façade", () => {
  test("returns 410 relay-only", async () => {
    const response = handleLocalMediaUploadDisabled()
    expect(response.status).toBe(410)
    const body = await response.json()
    expect(body.code).toBe("local_media_relay_only")
    expect(typeof body.error).toBe("string")
  })
})
