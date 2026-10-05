import { isIP } from "node:net"

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
])

function allowPrivateUrls(): boolean {
  return process.env.PROXY_ALLOW_PRIVATE_URLS === "true"
}

function isPrivateOrLocalIp(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === "::1" || normalized === "0.0.0.0") {
    return true
  }

  if (normalized.includes(":")) {
    // IPv6 unique-local / link-local
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    )
  }

  const parts = normalized.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string }

/**
 * Rejects non-http(s) and private/link-local/metadata targets (SSRF guard).
 * Set PROXY_ALLOW_PRIVATE_URLS=true only for local development.
 */
export function assertPublicHttpUrl(raw: string): UrlSafetyResult {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "invalid_url" }
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" }
  }

  if (allowPrivateUrls()) {
    return { ok: true, url }
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: "blocked_hostname" }
  }

  if (hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return { ok: false, reason: "blocked_hostname" }
  }

  if (isIP(hostname) && isPrivateOrLocalIp(hostname)) {
    return { ok: false, reason: "private_ip" }
  }

  return { ok: true, url }
}
