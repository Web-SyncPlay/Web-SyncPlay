/**
 * Runtime build / release metadata for the site footer.
 * Reads optional `APP_VERSION`, `APP_GIT_SHA`, `YTDLP_VERSION` from raw
 * `process.env` (baked at Docker/`next build` time for static routes); falls
 * back to package.json for the product semver. Keep this module server-only —
 * do not import from client.
 */

import packageJson from "../../package.json" with { type: "json" }

export const GITHUB_REPO_URL = "https://github.com/Web-SyncPlay/Web-SyncPlay"
export const YTDLP_RELEASES_URL = "https://github.com/yt-dlp/yt-dlp"

export type BuildInfo = {
  /** Product semver without a leading `v` (package.json / APP_VERSION). */
  appVersion: string
  /** Full git SHA when set and valid (APP_GIT_SHA); otherwise null. */
  gitSha: string | null
  /** Short SHA for display (7 chars) when {@link gitSha} is set. */
  gitShaShort: string | null
  /** Docker-pinned yt-dlp release tag when set (YTDLP_VERSION). */
  ytDlpVersion: string | null
  appReleaseUrl: string
  gitCommitUrl: string | null
  ytDlpReleaseUrl: string | null
}

function nonEmpty(raw: string | undefined): string | null {
  const trimmed = raw?.trim()
  return trimmed ? trimmed : null
}

/** Strip a leading `v` so display and tag URLs stay consistent. */
function normalizeSemver(raw: string): string {
  return raw.replace(/^v/i, "")
}

/** Accept 7–40 hex chars (short or full SHA); reject junk. */
function parseGitSha(raw: string | null): string | null {
  if (!raw) return null
  if (!/^[0-9a-f]{7,40}$/i.test(raw)) return null
  return raw.toLowerCase()
}

export function getBuildInfo(
  env: Record<string, string | undefined> = process.env,
): BuildInfo {
  const appVersion = normalizeSemver(
    nonEmpty(env.APP_VERSION) ?? packageJson.version,
  )
  const gitSha = parseGitSha(nonEmpty(env.APP_GIT_SHA))
  const ytDlpVersion = nonEmpty(env.YTDLP_VERSION)

  return {
    appVersion,
    gitSha,
    gitShaShort: gitSha ? gitSha.slice(0, 7) : null,
    ytDlpVersion,
    appReleaseUrl: `${GITHUB_REPO_URL}/releases/tag/v${encodeURIComponent(appVersion)}`,
    gitCommitUrl: gitSha
      ? `${GITHUB_REPO_URL}/commit/${encodeURIComponent(gitSha)}`
      : null,
    ytDlpReleaseUrl: ytDlpVersion
      ? `${YTDLP_RELEASES_URL}/releases/tag/${encodeURIComponent(ytDlpVersion)}`
      : null,
  }
}
