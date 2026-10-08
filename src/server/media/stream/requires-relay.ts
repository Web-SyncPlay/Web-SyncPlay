import { isPrivateOrLoopbackHttpUrl } from "@/server/security/url-safety"

/**
 * Hosts that often pass a CORS probe but still reject browser playback
 * (hotlink Referer, signed cookies, CDN ACL). Always relay these.
 */
const RELAY_HOST_SUFFIXES = [
  "soundcloud.com",
  "sndcdn.com",
  "soundcloud.cloud",
] as const

export function hostRequiresMediaRelay(rawUrl: string): boolean {
  // Browsers block or restrict direct fetch to LAN/loopback (Private Network
  // Access). When such URLs are allowed at all (dev PROXY_ALLOW_PRIVATE_URLS),
  // always same-origin relay — production still rejects them in url-safety.
  if (isPrivateOrLoopbackHttpUrl(rawUrl)) {
    return true
  }
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return RELAY_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}
