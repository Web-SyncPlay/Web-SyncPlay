import { randomUUID } from "node:crypto"
import { MEDIA_FETCH_UA } from "@/server/media/media-ua"
import { sha256HexUrl } from "@/server/media/url-hash"
import { assertPublicHttpUrl } from "@/server/security/url-safety"
import { getCommandClient } from "../redis/client"
import { keys } from "../redis/keys"
import { roomStateTtlSeconds } from "@/zod/types"

/**
 * Tokens map UUID → upstream URL + fetch metadata.
 * Sliding expiry on each successful proxy hit keeps active streams alive.
 */
export const PROXY_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7

export type ProxyTokenPayload = {
  url: string
  referer?: string
  userAgent?: string
  roomId?: string
  mediaId?: string
  createdAt: number
}

/** Default UA stamped on relay mints when callers omit one. */
export const PROXY_DEFAULT_UA = MEDIA_FETCH_UA

function parseProxyTokenPayload(
  raw: string,
): ProxyTokenPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ProxyTokenPayload>
    if (typeof parsed.url !== "string") return null
    return {
      url: parsed.url,
      referer: typeof parsed.referer === "string" ? parsed.referer : undefined,
      userAgent:
        typeof parsed.userAgent === "string" ? parsed.userAgent : undefined,
      roomId: typeof parsed.roomId === "string" ? parsed.roomId : undefined,
      mediaId: typeof parsed.mediaId === "string" ? parsed.mediaId : undefined,
      createdAt:
        typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
    }
  } catch {
    return null
  }
}

function metaUpgraded(
  existing: ProxyTokenPayload,
  meta: Omit<ProxyTokenPayload, "url" | "createdAt">,
): ProxyTokenPayload | null {
  const next: ProxyTokenPayload = {
    ...existing,
    referer: meta.referer ?? existing.referer,
    userAgent: meta.userAgent ?? existing.userAgent,
    roomId: meta.roomId ?? existing.roomId,
    mediaId: meta.mediaId ?? existing.mediaId,
  }
  const changed =
    next.referer !== existing.referer ||
    next.userAgent !== existing.userAgent ||
    next.roomId !== existing.roomId ||
    next.mediaId !== existing.mediaId
  return changed ? next : null
}

export async function createProxyUrl(
  targetUrl: string,
  meta?: Omit<ProxyTokenPayload, "url" | "createdAt">,
): Promise<string> {
  const safety = assertPublicHttpUrl(targetUrl)
  if (!safety.ok) {
    throw new Error(`Refusing to proxy unsafe URL (${safety.reason})`)
  }

  const client = await getCommandClient()
  const urlHash = sha256HexUrl(targetUrl)
  const byUrlKey = keys.mediaProxyByUrl(urlHash)
  const existingToken = await client.get(byUrlKey)
  if (existingToken) {
    const tokenKey = keys.mediaProxyToken(existingToken)
    const existingRaw = await client.get(tokenKey)
    if (existingRaw) {
      const existing = parseProxyTokenPayload(existingRaw)

      // Upgrade a bare token when a later mint carries Referer / room meta
      // (HLS child rewrite must not stick with a no-referer first mint).
      if (existing && meta) {
        const upgraded = metaUpgraded(existing, meta)
        if (upgraded) {
          await client.set(tokenKey, JSON.stringify(upgraded), {
            EX: PROXY_TOKEN_TTL_SECONDS,
          })
        } else {
          await client.expire(tokenKey, PROXY_TOKEN_TTL_SECONDS)
        }
      } else {
        await client.expire(tokenKey, PROXY_TOKEN_TTL_SECONDS)
      }
      await client.expire(byUrlKey, PROXY_TOKEN_TTL_SECONDS)
      return `/api/media/proxy/${existingToken}`
    }
  }

  const token = randomUUID()
  const payload: ProxyTokenPayload = {
    url: targetUrl,
    referer: meta?.referer,
    userAgent: meta?.userAgent,
    roomId: meta?.roomId,
    mediaId: meta?.mediaId,
    createdAt: Date.now(),
  }
  await client.set(keys.mediaProxyToken(token), JSON.stringify(payload), {
    EX: PROXY_TOKEN_TTL_SECONDS,
  })
  await client.set(byUrlKey, token, { EX: PROXY_TOKEN_TTL_SECONDS })
  return `/api/media/proxy/${token}`
}

export async function getProxyTokenPayload(
  token: string,
): Promise<ProxyTokenPayload | null> {
  const client = await getCommandClient()
  const key = keys.mediaProxyToken(token)
  const raw = await client.get(key)
  if (!raw) return null
  return parseProxyTokenPayload(raw)
}

export async function getProxyTarget(token: string): Promise<string | null> {
  const payload = await getProxyTokenPayload(token)
  return payload?.url ?? null
}

/** Extend TTL when a token is still used (manifest/segment requests). */
export async function refreshProxyTokenTtl(token: string): Promise<void> {
  const client = await getCommandClient()
  const key = keys.mediaProxyToken(token)
  const payload = await getProxyTokenPayload(token)
  await client.expire(key, PROXY_TOKEN_TTL_SECONDS)
  if (payload?.url) {
    await client.expire(
      keys.mediaProxyByUrl(sha256HexUrl(payload.url)),
      PROXY_TOKEN_TTL_SECONDS,
    )
  }
}

export async function roomStillExists(roomId: string | undefined): Promise<boolean> {
  if (!roomId) return true
  const client = await getCommandClient()
  const exists = await client.exists(keys.roomState(roomId))
  return exists === 1
}

export { roomStateTtlSeconds }
