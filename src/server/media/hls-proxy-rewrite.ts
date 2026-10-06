import {
  createProxyUrl,
  type ProxyTokenPayload,
} from "@/server/media/proxy-token"

export type HlsRewriteProxyMeta = Omit<ProxyTokenPayload, "url" | "createdAt">

/**
 * Collect every absolute http(s) URL referenced by an HLS playlist (master or media).
 */
function collectM3u8ReferencedUrls(body: string, baseUrl: string): Set<string> {
  const set = new Set<string>()

  const addResolved = (raw: string) => {
    try {
      const abs = new URL(raw.trim(), baseUrl).href
      if (/^https?:\/\//i.test(abs)) {
        set.add(abs)
      }
    } catch {
      // ignore invalid
    }
  }

  const quotedUri = /URI="([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = quotedUri.exec(body)) !== null) {
    const raw = m[1]
    if (typeof raw === "string") addResolved(raw)
  }

  const singleQuotedUri = /URI='([^']+)'/g
  while ((m = singleQuotedUri.exec(body)) !== null) {
    const raw = m[1]
    if (typeof raw === "string") addResolved(raw)
  }

  for (const line of body.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) {
      continue
    }
    addResolved(t)
  }

  return set
}

function rewriteLineWithMap(
  line: string,
  baseUrl: string,
  proxyMap: Map<string, string>,
): string {
  let result = line.replace(/URI="([^"]+)"/g, (full, uri: string) => {
    try {
      const abs = new URL(uri, baseUrl).href
      const proxied = proxyMap.get(abs)
      return proxied !== undefined ? `URI="${proxied}"` : full
    } catch {
      return full
    }
  })

  result = result.replace(/URI='([^']+)'/g, (full, uri: string) => {
    try {
      const abs = new URL(uri, baseUrl).href
      const proxied = proxyMap.get(abs)
      return proxied !== undefined ? `URI='${proxied}'` : full
    } catch {
      return full
    }
  })

  const trimmed = result.trimEnd()
  const leadingLen = result.length - trimmed.length
  const leadWs = result.slice(0, leadingLen)
  const content = trimmed.trim()
  if (content && !content.startsWith("#")) {
    try {
      const abs = new URL(content, baseUrl).href
      const proxied = proxyMap.get(abs)
      if (proxied !== undefined) {
        return `${leadWs}${proxied}`
      }
    } catch {
      // keep line
    }
  }

  return result
}

function looksLikeHlsPlaylist(body: string, contentType: string): boolean {
  const ct = contentType.toLowerCase()
  if (ct.includes("mpegurl") || ct.includes("m3u8")) {
    return true
  }
  const head = body.slice(0, 200).trimStart()
  return head.startsWith("#EXTM3U")
}

/**
 * Rewrites all referenced http(s) URLs in an HLS playlist to same-origin proxy paths
 * so the browser never loads Twitch/CDN URLs directly (avoids CORS / status 0).
 * Child tokens inherit parent referer / room meta so hotlink-protected CDNs keep working.
 */
export async function rewriteM3u8ForProxy(
  body: string,
  baseUrl: string,
  meta?: HlsRewriteProxyMeta,
): Promise<string> {
  const urls = [...collectM3u8ReferencedUrls(body, baseUrl)]
  const proxyMap = new Map<string, string>()
  await Promise.all(
    urls.map(async (u) => {
      proxyMap.set(u, await createProxyUrl(u, meta))
    }),
  )

  const lines = body.split(/\r?\n/)
  return lines
    .map((line) => rewriteLineWithMap(line, baseUrl, proxyMap))
    .join("\n")
}

export function shouldAttemptPlaylistRewrite(
  contentType: string,
  bodySample: string,
): boolean {
  return looksLikeHlsPlaylist(bodySample, contentType)
}
