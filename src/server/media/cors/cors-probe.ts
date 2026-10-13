import { MEDIA_FETCH_UA } from "@/server/media/media-ua"

/**
 * Probe whether a browser can fetch `url` cross-origin for media playback.
 *
 * HEAD alone is unreliable (many CDNs omit CORS on HEAD or reject it). We:
 * 1. Send a synthetic Origin
 * 2. Prefer HEAD + Range
 * 3. Fall back to a tiny GET Range when HEAD is inconclusive
 * 4. Require a real ACAO match (`*` or exact origin) — not a loose substring
 * 5. Treat upstream 401/403/404/5xx as unreachable even when ACAO is present
 *    (GCS/XML error bodies often advertise `ACAO: *`)
 */

const PROBE_ORIGIN = "https://playback.web-syncplay.local"
const PROBE_TIMEOUT_MS = 4_000

export type UpstreamPlaybackProbe = "allowed" | "blocked" | "unreachable"

export function acaoAllowsBrowserPlayback(
  allowOrigin: string | null,
  requestOrigin: string = PROBE_ORIGIN,
): boolean {
  if (!allowOrigin) return false
  const trimmed = allowOrigin.trim()
  if (!trimmed || trimmed === "null") return false
  if (trimmed === "*") return true
  return trimmed === requestOrigin
}

function probeHeaders(): HeadersInit {
  return {
    Origin: PROBE_ORIGIN,
    Range: "bytes=0-1",
    "User-Agent": MEDIA_FETCH_UA,
  }
}

async function fetchProbe(
  url: string,
  method: "HEAD" | "GET",
): Promise<Response | null> {
  try {
    return await fetch(url, {
      method,
      cache: "no-store",
      redirect: "follow",
      headers: probeHeaders(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch {
    return null
  }
}

function isUnreachableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 410 ||
    status >= 500
  )
}

function isSuccessStatus(status: number): boolean {
  return status === 200 || status === 206 || status === 304
}

/**
 * Classify one probe response.
 * - `allowed` / `blocked` / `unreachable` are definitive
 * - `null` means try the other HTTP verb
 */
function classifyProbeResponse(
  response: Response | null,
): UpstreamPlaybackProbe | null {
  if (!response) return null
  // Method not allowed / not implemented → try the other verb.
  if (response.status === 405 || response.status === 501) return null
  if (isUnreachableStatus(response.status)) return "unreachable"
  if (!isSuccessStatus(response.status)) return null

  const allowOrigin = response.headers.get("access-control-allow-origin")
  if (acaoAllowsBrowserPlayback(allowOrigin)) return "allowed"
  // No usable ACAO on an otherwise-OK response — CORS blocked (or HEAD omits it).
  // HEAD without ACAO is inconclusive (many CDNs only attach CORS on GET).
  return null
}

export async function probeUpstreamPlayback(
  url: string,
): Promise<UpstreamPlaybackProbe> {
  const head = await fetchProbe(url, "HEAD")
  const headVerdict = classifyProbeResponse(head)
  if (headVerdict !== null) return headVerdict
  // Successful HEAD without ACAO: still try GET before concluding blocked.
  if (head && isSuccessStatus(head.status)) {
    // fall through
  }

  const get = await fetchProbe(url, "GET")
  if (!get) {
    // Network failure. If HEAD succeeded without ACAO, treat as blocked
    // (reachable enough to relay); otherwise unreachable.
    if (head && isSuccessStatus(head.status)) return "blocked"
    return "unreachable"
  }
  // Drain a tiny body so the socket can close cleanly.
  try {
    await get.arrayBuffer()
  } catch {
    // ignore
  }

  if (isUnreachableStatus(get.status)) return "unreachable"
  if (!isSuccessStatus(get.status)) {
    if (head && isSuccessStatus(head.status)) return "blocked"
    return "unreachable"
  }
  return acaoAllowsBrowserPlayback(
    get.headers.get("access-control-allow-origin"),
  )
    ? "allowed"
    : "blocked"
}

/** True only when the upstream is reachable and ACAO allows browser playback. */
export async function probeCorsPlayback(url: string): Promise<boolean> {
  return (await probeUpstreamPlayback(url)) === "allowed"
}
