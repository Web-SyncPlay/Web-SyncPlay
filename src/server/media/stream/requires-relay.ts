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
  try {
    const host = new URL(rawUrl).hostname.toLowerCase()
    return RELAY_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  } catch {
    return false
  }
}
