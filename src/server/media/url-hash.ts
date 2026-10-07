import { createHash } from "node:crypto"

/** Full SHA-256 hex of a URL (Valkey extract / proxy-by-url keys). */
export function sha256HexUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex")
}

/** Short prefix for in-process cache keys (HLS rewrite LRU). */
export function sha256HexUrlPrefix(url: string, length = 16): string {
  return sha256HexUrl(url).slice(0, length)
}
