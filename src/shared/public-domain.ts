/**
 * CORS / CSP / mediasoup ICE helpers.
 * Reads `PUBLIC_DOMAIN` / `EMBED_FRAME_ANCESTORS` from raw `process.env` so Edge
 * (`src/proxy.ts`) need not import `@/env` (full server schema). Validated in
 * `src/env.ts` on Node boot; prefer `env.*` on Node when already loaded.
 */

/** Fixed mediasoup WebRtcServer UDP port. */
export const MEDIASOUP_RTC_UDP_PORT = 40000 as const

/** Bare host or origin, e.g. `web-syncplay.de` / `https://web-syncplay.de`. */
export function getPublicDomain(
  rawPublicDomain: string | undefined = process.env.PUBLIC_DOMAIN,
): string | undefined {
  const raw = rawPublicDomain?.trim()
  return raw || undefined
}

function hostnameFromBareOrUrl(domain: string): string | undefined {
  try {
    if (domain.includes("://")) {
      return new URL(domain).hostname
    }
  } catch {
    // fall through — treat as bare host
  }
  return domain.replace(/\/.*$/, "").replace(/:\d+$/, "") || undefined
}

function isLocalHttpHost(host: string): boolean {
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:")
  )
}

/** http(s) origin → ws(s) for CSP connect-src. */
function toWebSocketOrigin(httpOrigin: string): string {
  if (httpOrigin.startsWith("https://")) {
    return `wss://${httpOrigin.slice("https://".length)}`
  }
  if (httpOrigin.startsWith("http://")) {
    return `ws://${httpOrigin.slice("http://".length)}`
  }
  return httpOrigin
}

/** Hostname only — used for mediasoup ICE `announcedAddress`. */
export function getPublicHostname(
  rawPublicDomain: string | undefined = process.env.PUBLIC_DOMAIN,
): string | undefined {
  const domain = getPublicDomain(rawPublicDomain)
  if (!domain) return undefined
  return hostnameFromBareOrUrl(domain)
}

/** Canonical https origin for CORS / CSP (http for localhost*). */
export function getPublicOrigin(
  rawPublicDomain: string | undefined = process.env.PUBLIC_DOMAIN,
): string | undefined {
  const domain = getPublicDomain(rawPublicDomain)
  if (!domain) return undefined
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain.replace(/\/$/, "")
  }
  const host = domain.replace(/\/.*$/, "")
  return `${isLocalHttpHost(host) ? "http" : "https"}://${host}`
}

export function isOriginAllowed(
  origin: string | null,
  rawPublicDomain: string | undefined = process.env.PUBLIC_DOMAIN,
): boolean {
  if (!origin) return false
  const publicOrigin = getPublicOrigin(rawPublicDomain)
  if (publicOrigin) {
    return origin === publicOrigin
  }
  // Dev / unset PUBLIC_DOMAIN: allow local tooling origins.
  try {
    const url = new URL(origin)
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    )
  } catch {
    return false
  }
}

/**
 * `EMBED_FRAME_ANCESTORS` tokens (origins or sole `*`). Empty → no third-party
 * framing. Trailing slashes stripped for CSP.
 */
export function getEmbedFrameAncestors(
  rawAncestors: string | undefined = process.env.EMBED_FRAME_ANCESTORS,
): string[] {
  const raw = rawAncestors?.trim()
  if (!raw) return []
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token === "*") return token
      return token.replace(/\/$/, "")
    })
}

function buildFrameAncestorsDirective(
  rawPublicDomain: string | undefined = process.env.PUBLIC_DOMAIN,
  rawAncestors: string | undefined = process.env.EMBED_FRAME_ANCESTORS,
): string {
  const ancestors = getEmbedFrameAncestors(rawAncestors)
  if (ancestors.length === 1 && ancestors[0] === "*") {
    return "frame-ancestors *"
  }
  const publicOrigin = getPublicOrigin(rawPublicDomain)
  const parts = ["'self'"]
  if (publicOrigin) parts.push(publicOrigin)
  for (const origin of ancestors) {
    if (origin !== "*" && !parts.includes(origin)) {
      parts.push(origin)
    }
  }
  return `frame-ancestors ${parts.join(" ")}`
}

/**
 * Content-Security-Policy tuned for SyncPlay + optional public origin.
 *
 * Native providers (YouTube/Vimeo) load via iframes; without an explicit
 * `frame-src` they inherit `default-src 'self'` and fail to embed.
 * Remote direct media (mp4/hls/etc.) needs open `media-src` / `connect-src`.
 */
export function buildContentSecurityPolicy(
  rawPublicDomain: string | undefined = process.env.PUBLIC_DOMAIN,
  rawAncestors: string | undefined = process.env.EMBED_FRAME_ANCESTORS,
): string {
  const publicOrigin = getPublicOrigin(rawPublicDomain)
  const connect = publicOrigin
    ? `'self' ${publicOrigin} ${toWebSocketOrigin(publicOrigin)} https: wss: blob:`
    : `'self' https: http: wss: ws: blob:`

  // YouTube IFrame API (+ nocookie) and Vimeo player postMessage bridge.
  const nativeEmbedScripts =
    "https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com"

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    buildFrameAncestorsDirective(rawPublicDomain, rawAncestors),
    // Allow any https/http iframe so YouTube/Vimeo (and similar) embeds work.
    "frame-src 'self' https: http:",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${nativeEmbedScripts}`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    // Direct remote media URLs (mp4, webm, HLS, audio, …).
    "media-src 'self' blob: https: http:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "form-action 'self'",
  ]
  return directives.join("; ")
}
