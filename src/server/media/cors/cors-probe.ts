import { MEDIA_FETCH_UA } from "@/server/media/media-ua"

/**
 * Probe whether a browser can fetch `url` cross-origin for media playback.
 *
 * HEAD alone is unreliable (many CDNs omit CORS on HEAD or reject it). We:
 * 1. Send a synthetic Origin
 * 2. Prefer HEAD + Range
 * 3. Fall back to a tiny GET Range when HEAD is inconclusive
 * 4. Require a real ACAO match (`*` or exact origin) — not a loose substring
 */

const PROBE_ORIGIN = "https://playback.web-syncplay.local"
const PROBE_TIMEOUT_MS = 4_000

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

function corsFromResponse(response: Response | null): boolean | null {
  if (!response) return null
  // Method not allowed / not implemented → try the other verb.
  if (response.status === 405 || response.status === 501) return null
  const allowOrigin = response.headers.get("access-control-allow-origin")
  if (acaoAllowsBrowserPlayback(allowOrigin)) return true
  // No usable ACAO on HEAD is inconclusive — many CDNs only attach CORS on GET.
  return null
}

export async function probeCorsPlayback(url: string): Promise<boolean> {
  const head = await fetchProbe(url, "HEAD")
  const headVerdict = corsFromResponse(head)
  if (headVerdict !== null) return headVerdict

  const get = await fetchProbe(url, "GET")
  if (!get) return false
  // Drain a tiny body so the socket can close cleanly.
  try {
    await get.arrayBuffer()
  } catch {
    // ignore
  }
  return acaoAllowsBrowserPlayback(
    get.headers.get("access-control-allow-origin"),
  )
}
