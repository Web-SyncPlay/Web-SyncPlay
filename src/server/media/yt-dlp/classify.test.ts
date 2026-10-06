import { expect, test } from "bun:test"
import {
  classifyYtDlpRunFailure,
  classifyYtDlpStderr,
} from "@/server/media/yt-dlp/classify"

test("classifies offline / not-live stderr", () => {
  const result = classifyYtDlpStderr(
    "ERROR: [twitch:stream] cool_user: The channel is not currently live",
  )
  expect(result.classification).toBe("not_live")
  expect(result.userMessage).toContain("not live")
})

test("classifies 404 / missing video", () => {
  const result = classifyYtDlpStderr("ERROR: [youtube] abc: Video does not exist")
  expect(result.classification).toBe("not_found")
})

test("classifies login / private content", () => {
  const result = classifyYtDlpStderr("ERROR: Private video. Sign in to confirm")
  expect(result.classification).toBe("login_required")
})

test("classifies network / 403", () => {
  const result = classifyYtDlpStderr("ERROR: Unable to download webpage: HTTP Error 403")
  expect(result.classification).toBe("network")
})

test("unknown stderr falls back to first-line snippet", () => {
  const result = classifyYtDlpStderr("ERROR: mysterious extractor failure\nmore detail")
  expect(result.classification).toBe("unknown")
  expect(result.userMessage).toContain("mysterious extractor failure")
})

test("run failure: timeout and missing binary", () => {
  expect(
    classifyYtDlpRunFailure({ stderr: "", failureKind: "timeout" }).classification,
  ).toBe("timeout")
  expect(
    classifyYtDlpRunFailure({
      stderr: "",
      failureKind: "spawn_error",
      spawnErrorCode: "ENOENT",
    }).classification,
  ).toBe("binary_missing")
})
