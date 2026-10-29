import { describe, expect, test } from "bun:test"

import { getBuildInfo, GITHUB_REPO_URL, YTDLP_RELEASES_URL } from "./build-info"

describe("getBuildInfo", () => {
  test("falls back to package.json version without env overrides", () => {
    const info = getBuildInfo({})
    expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+/)
    expect(info.appReleaseUrl).toBe(
      `${GITHUB_REPO_URL}/releases/tag/v${info.appVersion}`,
    )
    expect(info.gitSha).toBeNull()
    expect(info.gitShaShort).toBeNull()
    expect(info.gitCommitUrl).toBeNull()
    expect(info.ytDlpVersion).toBeNull()
    expect(info.ytDlpReleaseUrl).toBeNull()
  })

  test("honors APP_VERSION, APP_GIT_SHA, and YTDLP_VERSION", () => {
    const info = getBuildInfo({
      APP_VERSION: "3.0.3",
      APP_GIT_SHA: "abcdef0123456789",
      YTDLP_VERSION: "2026.10.26",
    })
    expect(info.appVersion).toBe("3.0.3")
    expect(info.appReleaseUrl).toBe(`${GITHUB_REPO_URL}/releases/tag/v3.0.3`)
    expect(info.gitSha).toBe("abcdef0123456789")
    expect(info.gitShaShort).toBe("abcdef0")
    expect(info.gitCommitUrl).toBe(`${GITHUB_REPO_URL}/commit/abcdef0123456789`)
    expect(info.ytDlpVersion).toBe("2026.10.26")
    expect(info.ytDlpReleaseUrl).toBe(
      `${YTDLP_RELEASES_URL}/releases/tag/2026.10.26`,
    )
  })

  test("strips a leading v from APP_VERSION for display and release URL", () => {
    const info = getBuildInfo({ APP_VERSION: "v3.0.3" })
    expect(info.appVersion).toBe("3.0.3")
    expect(info.appReleaseUrl).toBe(`${GITHUB_REPO_URL}/releases/tag/v3.0.3`)
  })

  test("ignores non-hex APP_GIT_SHA", () => {
    const info = getBuildInfo({ APP_GIT_SHA: "not-a-sha!" })
    expect(info.gitSha).toBeNull()
    expect(info.gitShaShort).toBeNull()
    expect(info.gitCommitUrl).toBeNull()
  })

  test("treats blank env values as unset", () => {
    const info = getBuildInfo({
      APP_VERSION: "  ",
      APP_GIT_SHA: "",
      YTDLP_VERSION: "\t",
    })
    expect(info.gitSha).toBeNull()
    expect(info.ytDlpVersion).toBeNull()
    expect(info.appVersion).toMatch(/^\d+\.\d+\.\d+/)
  })
})
