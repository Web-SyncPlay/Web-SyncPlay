/**
 * Pure HLS playlist builders for local-media ABR / progressive fallback.
 */

export type LocalMediaHlsVariant = {
  localMediaId: string
  height: number
  bandwidth: number
  label: string
}

/** Append viewer capability query (`vt` / `uid`) to playlist child URLs. */
function withViewerQuery(
  path: string,
  viewerQuery?: Record<string, string> | null,
): string {
  if (!viewerQuery) return path
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(viewerQuery)) {
    if (value) params.set(key, value)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function buildLocalMediaMasterPlaylist(input: {
  parentId: string
  variants?: LocalMediaHlsVariant[] | null
  viewerQuery?: Record<string, string> | null
}): string {
  const parentId = encodeURIComponent(input.parentId)
  const variants = input.variants?.filter((v) => v.localMediaId) ?? []

  if (variants.length === 0) {
    return [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      "#EXT-X-INDEPENDENT-SEGMENTS",
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,CODECS="avc1.42E01E,mp4a.40.2"',
      withViewerQuery(
        `/api/media/local/${parentId}/hls/${parentId}`,
        input.viewerQuery,
      ),
      "",
    ].join("\n")
  }

  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-INDEPENDENT-SEGMENTS"]
  // Highest first so players prefer the top rung when starting.
  const ordered = [...variants].sort((a, b) => b.height - a.height)
  for (const variant of ordered) {
    const id = encodeURIComponent(variant.localMediaId)
    const res =
      variant.height > 0
        ? `,RESOLUTION=${Math.round((variant.height * 16) / 9)}x${variant.height}`
        : ""
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${Math.max(1, Math.round(variant.bandwidth))}${res},CODECS="avc1.42E01E,mp4a.40.2",NAME="${escapeHlsQuoted(variant.label)}"`,
    )
    lines.push(
      withViewerQuery(
        `/api/media/local/${parentId}/hls/${id}`,
        input.viewerQuery,
      ),
    )
  }
  lines.push("")
  return lines.join("\n")
}

export function buildLocalMediaVariantPlaylist(input: {
  variantLocalMediaId: string
  durationSec: number
  viewerQuery?: Record<string, string> | null
}): string {
  const duration = Math.max(1, Math.ceil(input.durationSec || 1))
  const mediaPath = withViewerQuery(
    `/api/media/local/${encodeURIComponent(input.variantLocalMediaId)}`,
    input.viewerQuery,
  )
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:" + duration,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXTINF:${duration}.0,`,
    mediaPath,
    "#EXT-X-ENDLIST",
    "",
  ].join("\n")
}

function escapeHlsQuoted(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
