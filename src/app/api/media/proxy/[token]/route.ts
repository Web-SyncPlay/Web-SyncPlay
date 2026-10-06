import {
  rewriteM3u8ForProxy,
  shouldAttemptPlaylistRewrite,
} from "@/server/media/hls-proxy-rewrite"
import {
  getOrComputeHlsRewrite,
  peekHlsRewriteCache,
} from "@/server/media/hls-rewrite-cache"
import {
  getProxyTokenPayload,
  refreshProxyTokenTtl,
  roomStillExists,
} from "@/server/media/proxy-token"
import {
  isStaleUpstreamStatus,
  scheduleStaleUpstreamRefresh,
} from "@/server/media/stale-upstream-refresh"
import {
  clientIpFromRequest,
  consumeRateLimit,
} from "@/server/security/rate-limit"
import { assertPublicHttpUrl } from "@/server/security/url-safety"
import { NextResponse } from "next/server"

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

function playlistTargetHint(target: string, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct.includes("mpegurl") || ct.includes("m3u8")) return true
  if (/\.m3u8(\?|$)/i.test(target)) return true
  // Opaque CDN playlists often use octet-stream without .m3u8
  if (
    (ct === "" ||
      ct.includes("octet-stream") ||
      ct.includes("text/plain")) &&
    !/\.(ts|m4s|mp4|webm|aac|m4a)(\?|$)/i.test(target)
  ) {
    return true
  }
  return false
}

function buildUpstreamHeaders(
  request: Request,
  payload: { referer?: string; userAgent?: string },
): HeadersInit {
  const headers: Record<string, string> = {
    "user-agent": payload.userAgent || DEFAULT_UA,
  }
  if (payload.referer) {
    headers.referer = payload.referer
  }
  const range = request.headers.get("range")
  if (range) {
    headers.range = range
  }
  return headers
}

async function authorizeProxyRequest(request: Request, token: string) {
  const ip = clientIpFromRequest(request)
  const ipLimit = await consumeRateLimit({
    key: `proxy:ip:${ip}`,
    limit: 240,
    windowMs: 60_000,
  })
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  const tokenLimit = await consumeRateLimit({
    key: `proxy:token:${token}`,
    limit: 120,
    windowMs: 60_000,
  })
  if (!tokenLimit.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }
  return null
}

function passthroughHeaders(response: Response, range: string | null) {
  const headers = new Headers()
  const ct = response.headers.get("content-type") ?? "application/octet-stream"
  headers.set("content-type", ct)
  headers.set(
    "cache-control",
    range ? "private, no-store" : "private, max-age=60, no-transform",
  )
  headers.set(
    "accept-ranges",
    response.headers.get("accept-ranges") ?? "bytes",
  )
  for (const key of [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = response.headers.get(key)
    if (value) headers.set(key, value)
  }
  return headers
}

function playlistResponse(
  body: string,
  contentType: string,
): Response {
  const headers = new Headers()
  headers.set("content-type", contentType)
  headers.set(
    "cache-control",
    contentType.includes("mpegurl")
      ? "private, max-age=5, no-transform"
      : "private, no-store, no-transform",
  )
  headers.set("access-control-allow-origin", "*")
  return new Response(body, { status: 200, headers })
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const limited = await authorizeProxyRequest(request, token)
  if (limited) return limited

  const payload = await getProxyTokenPayload(token)
  if (!payload) {
    return NextResponse.json({ error: "Proxy token expired" }, { status: 404 })
  }

  if (!(await roomStillExists(payload.roomId))) {
    return NextResponse.json({ error: "Proxy token expired" }, { status: 404 })
  }

  const safety = assertPublicHttpUrl(payload.url)
  if (!safety.ok) {
    console.warn("[media-proxy] blocked upstream", { reason: safety.reason })
    return NextResponse.json({ error: "Forbidden upstream" }, { status: 403 })
  }

  await refreshProxyTokenTtl(token)

  const range = request.headers.get("range")

  // Serve rewritten HLS playlists from LRU before hitting upstream.
  if (!range) {
    const cached = peekHlsRewriteCache(token, payload.url)
    if (cached) {
      return playlistResponse(cached.body, cached.contentType)
    }
  }

  let target = payload.url
  let response = await fetch(target, {
    headers: buildUpstreamHeaders(request, payload),
    redirect: "manual",
  })

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")
  ) {
    const redirected = new URL(response.headers.get("location")!, target).href
    const redirectSafety = assertPublicHttpUrl(redirected)
    if (!redirectSafety.ok) {
      return NextResponse.json({ error: "Forbidden redirect" }, { status: 403 })
    }
    target = redirected
    response = await fetch(target, {
      headers: buildUpstreamHeaders(request, payload),
      redirect: "manual",
    })
  }

  if (isStaleUpstreamStatus(response.status)) {
    void scheduleStaleUpstreamRefresh(payload)
    return NextResponse.json(
      { error: "upstream_expired", retryable: true },
      { status: 409 },
    )
  }

  if (!response.ok || !response.body) {
    return NextResponse.json(
      { error: "Failed to fetch upstream media" },
      { status: 502 },
    )
  }

  const contentType = response.headers.get("content-type") ?? ""
  const tryRewrite =
    response.status === 200 &&
    !range &&
    playlistTargetHint(target, contentType)

  if (tryRewrite) {
    const rewritten = await getOrComputeHlsRewrite({
      token,
      upstreamUrl: payload.url,
      compute: async () => {
        const text = await response.text()
        if (shouldAttemptPlaylistRewrite(contentType, text)) {
          const body = await rewriteM3u8ForProxy(text, target)
          return {
            body,
            contentType: "application/vnd.apple.mpegurl; charset=utf-8",
          }
        }
        return {
          body: text,
          contentType: contentType || "application/octet-stream",
        }
      },
    })
    if (rewritten.cacheHit) {
      void response.body?.cancel()
    }
    return playlistResponse(rewritten.body, rewritten.contentType)
  }

  return new Response(response.body, {
    status: response.status,
    headers: passthroughHeaders(response, range),
  })
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const limited = await authorizeProxyRequest(request, token)
  if (limited) return limited

  const payload = await getProxyTokenPayload(token)
  if (!payload) {
    return new Response(null, { status: 404 })
  }
  if (!(await roomStillExists(payload.roomId))) {
    return new Response(null, { status: 404 })
  }
  const safety = assertPublicHttpUrl(payload.url)
  if (!safety.ok) {
    return new Response(null, { status: 403 })
  }

  await refreshProxyTokenTtl(token)

  const response = await fetch(payload.url, {
    method: "HEAD",
    headers: buildUpstreamHeaders(request, payload),
    redirect: "manual",
  })

  return new Response(null, {
    status: response.ok ? 200 : 502,
    headers: passthroughHeaders(response, request.headers.get("range")),
  })
}
