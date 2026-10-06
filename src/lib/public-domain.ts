/** Hardcoded mediasoup WebRtcServer UDP port (operators firewall this). */
export const MEDIASOUP_RTC_UDP_PORT = 40000 as const

/**
 * Host or origin operators set for public reachability.
 * Examples: `web-syncplay.de`, `https://web-syncplay.de`, `203.0.113.10`
 */
export function getPublicDomain(): string | undefined {
  const raw = process.env.PUBLIC_DOMAIN?.trim()
  return raw || undefined
}

/** Hostname only — used for mediasoup ICE `announcedAddress`. */
export function getPublicHostname(): string | undefined {
  const domain = getPublicDomain()
  if (!domain) return undefined
  try {
    if (domain.includes("://")) {
      return new URL(domain).hostname
    }
  } catch {
    // fall through
  }
  return domain.replace(/\/.*$/, "").replace(/:\d+$/, "") || undefined
}

/** Canonical https origin for CORS / CSP (http for localhost*). */
export function getPublicOrigin(): string | undefined {
  const domain = getPublicDomain()
  if (!domain) return undefined
  if (domain.startsWith("http://") || domain.startsWith("https://")) {
    return domain.replace(/\/$/, "")
  }
  const host = domain.replace(/\/.*$/, "")
  const isLocal =
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:")
  return `${isLocal ? "http" : "https"}://${host}`
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false
  const publicOrigin = getPublicOrigin()
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
 * Content-Security-Policy tuned for SyncPlay + optional public origin.
 *
 * Native providers (YouTube/Vimeo) load via iframes; without an explicit
 * `frame-src` they inherit `default-src 'self'` and fail to embed.
 * Remote direct media (mp4/hls/etc.) needs open `media-src` / `connect-src`.
 */
export function buildContentSecurityPolicy(): string {
  const publicOrigin = getPublicOrigin()
  const connect = publicOrigin
    ? `'self' ${publicOrigin} ${publicOrigin.replace(/^http/, "ws")} https: wss: blob:`
    : `'self' https: http: wss: ws: blob:`

  // YouTube IFrame API (+ nocookie) and Vimeo player postMessage bridge.
  const nativeEmbedScripts =
    "https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com"

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'" + (publicOrigin ? ` ${publicOrigin}` : ""),
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
