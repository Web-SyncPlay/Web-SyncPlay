import { env } from "@/env"
import { promises as dns } from "node:dns"
import { isIP } from "node:net"

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
])

const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local"] as const

function allowPrivateUrls(): boolean {
  return env.PROXY_ALLOW_PRIVATE_URLS
}

/** Resolve A/AAAA (and /etc/hosts) addresses for a hostname. */
export type DnsAddressLookup = (hostname: string) => Promise<readonly string[]>

async function defaultDnsLookup(hostname: string): Promise<readonly string[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => entry.address)
}

export type AssertPublicHttpUrlResolvedOptions = {
  /** Injectable DNS lookup for tests; defaults to `dns.lookup({ all: true })`. */
  lookup?: DnsAddressLookup
}

/** Strip brackets and trailing FQDN dots (`localhost.` → `localhost`). */
function normalizeHostname(hostname: string): string {
  let host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  while (host.endsWith(".")) {
    host = host.slice(0, -1)
  }
  return host
}

/**
 * Map IPv4-mapped IPv6 (`::ffff:127.0.0.1` / `::ffff:7f00:1`) back to dotted IPv4.
 */
function ipv4MappedToDotted(ip: string): string | null {
  const normalized = ip.toLowerCase()
  const dotted = normalized.match(
    /(?:^|:)ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/,
  )
  if (dotted) {
    return `${dotted[1]}.${dotted[2]}.${dotted[3]}.${dotted[4]}`
  }

  const hex = normalized.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex || hex[1] === undefined || hex[2] === undefined) {
    return null
  }
  const hi = Number.parseInt(hex[1], 16)
  const lo = Number.parseInt(hex[2], 16)
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`
}

function isPrivateOrLocalIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part))
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

function isPrivateOrLocalIp(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized === "0.0.0.0"
  ) {
    return true
  }

  const mapped = ipv4MappedToDotted(normalized)
  if (mapped !== null) {
    return isPrivateOrLocalIpv4(mapped)
  }

  if (normalized.includes(":")) {
    // IPv6 unique-local / link-local (fc00::/7, fe80::/10)
    return (
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    )
  }

  return isPrivateOrLocalIpv4(normalized)
}

/** True when the URL host is loopback, .local, or a private/link-local IP. */
export function isPrivateOrLoopbackHttpUrl(rawUrl: string): boolean {
  try {
    const hostname = normalizeHostname(new URL(rawUrl).hostname)
    if (BLOCKED_HOSTNAMES.has(hostname)) return true
    if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return true
    }
    return isIP(hostname) !== 0 && isPrivateOrLocalIp(hostname)
  } catch {
    return false
  }
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

  const hostname = normalizeHostname(url.hostname)
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: "blocked_hostname" }
  }

  if (
    BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    return { ok: false, reason: "blocked_hostname" }
  }

  if (isIP(hostname) && isPrivateOrLocalIp(hostname)) {
    return { ok: false, reason: "private_ip" }
  }

  return { ok: true, url }
}

/**
 * Same as {@link assertPublicHttpUrl}, then DNS-resolves the hostname and
 * rejects when any A/AAAA (or hosts-file) address is private/link-local/metadata.
 * Skipped when PROXY_ALLOW_PRIVATE_URLS is set, or when the host is already an IP.
 */
export async function assertPublicHttpUrlResolved(
  raw: string,
  options?: AssertPublicHttpUrlResolvedOptions,
): Promise<UrlSafetyResult> {
  const sync = assertPublicHttpUrl(raw)
  if (!sync.ok) return sync

  if (allowPrivateUrls()) {
    return sync
  }

  const hostname = normalizeHostname(sync.url.hostname)
  if (isIP(hostname) !== 0) {
    // Literal IPs were already checked by the sync path.
    return sync
  }

  const lookup = options?.lookup ?? defaultDnsLookup
  let addresses: readonly string[]
  try {
    addresses = await lookup(hostname)
  } catch {
    return { ok: false, reason: "dns_lookup_failed" }
  }

  if (addresses.length === 0) {
    return { ok: false, reason: "dns_lookup_failed" }
  }

  for (const address of addresses) {
    if (isPrivateOrLocalIp(address)) {
      return { ok: false, reason: "private_ip" }
    }
  }

  return sync
}
