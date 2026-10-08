export type LocalAudioTrackOption = {
  id: string
  label: string
  language: string
  selected: boolean
  index: number
}

export type LocalVideoQualityOption = {
  id: string
  label: string
  selected: boolean
  /** `-1` selects automatic quality. */
  index: number
}

export const AUDIO_TRACK_STORAGE_PREFIX = "web-syncplay:local-audio-track:"
export const VIDEO_QUALITY_STORAGE_PREFIX = "web-syncplay:local-video-quality:"

export function trackStorageKey(
  itemId: string | undefined,
  kind: "audio" | "video",
): string | null {
  if (!itemId) {
    return null
  }
  return `${kind === "audio" ? AUDIO_TRACK_STORAGE_PREFIX : VIDEO_QUALITY_STORAGE_PREFIX}${itemId}`
}

export function audioTrackLabel(
  track: { label?: string; language?: string },
  index: number,
): string {
  const label = track.label?.trim()
  if (label) {
    return label
  }
  const language = track.language?.trim()
  if (language) {
    return language
  }
  return `Audio ${index + 1}`
}

export function videoQualityLabel(quality: {
  id?: string
  height?: number
  bitrate?: number | null
}): string {
  const height = Number(quality.height)
  if (Number.isFinite(height) && height > 0) {
    const bitrate = Number(quality.bitrate)
    const bitrateText =
      Number.isFinite(bitrate) && bitrate > 0
        ? ` · ${Math.round(bitrate / 1000)} kbps`
        : ""
    return `${height}p${bitrateText}`
  }
  return quality.id || "Quality"
}

/** Prefer a stable, human-readable option id (avoid bare numeric provider ids). */
export function audioTrackOptionId(
  track: { id?: string; language?: string; label?: string },
  index: number,
): string {
  const id = track.id?.trim()
  if (id && !/^\d+$/.test(id)) {
    return id
  }
  const language = track.language?.trim()
  if (language) {
    return `${language}-${index}`
  }
  return `audio-${index}`
}

export function snapshotAudioTracks(
  tracks: Array<{
    id?: string
    label?: string
    language?: string
    selected: boolean
  }>,
): LocalAudioTrackOption[] {
  return tracks.map((track, index) => ({
    id: audioTrackOptionId(track, index),
    label: audioTrackLabel(track, index),
    language: track.language ?? "",
    selected: track.selected,
    index,
  }))
}

export function snapshotVideoQualities(input: {
  qualities: Array<{
    id?: string
    height?: number
    bitrate?: number | null
    selected: boolean
  }>
  auto: boolean
}): LocalVideoQualityOption[] {
  const list = input.qualities
  if (list.length <= 1) {
    return []
  }

  const options: LocalVideoQualityOption[] = [
    {
      id: "auto",
      label: "Auto",
      selected: input.auto,
      index: -1,
    },
  ]

  for (let index = 0; index < list.length; index += 1) {
    const quality = list[index]!
    options.push({
      id: quality.id || `quality-${index}`,
      label: videoQualityLabel(quality),
      selected: !input.auto && quality.selected,
      index,
    })
  }
  return options
}

/** Find a stored audio preference in the current track list. */
export function findStoredAudioTrackIndex(
  tracks: Array<{ id?: string; label?: string; language?: string }>,
  stored: string | null | undefined,
): number {
  if (!stored) {
    return -1
  }
  return tracks.findIndex(
    (track, index) =>
      track.id === stored ||
      track.language === stored ||
      audioTrackLabel(track, index) === stored,
  )
}

/** Find a stored video-quality preference (`auto` or quality id/label). */
export function findStoredVideoQualityIndex(
  qualities: Array<{
    id?: string
    height?: number
    bitrate?: number | null
  }>,
  stored: string | null | undefined,
): number | "auto" | -1 {
  if (!stored) {
    return -1
  }
  if (stored === "auto") {
    return "auto"
  }
  const matchIndex = qualities.findIndex(
    (quality) =>
      quality.id === stored || videoQualityLabel(quality) === stored,
  )
  return matchIndex >= 0 ? matchIndex : -1
}

/** Persist key for a selected audio track. */
export function audioTrackStorageValue(
  track: { id?: string; language?: string; label?: string },
  index: number,
): string {
  return track.id || track.language || audioTrackLabel(track, index)
}

/** Persist key for a selected video quality. */
export function videoQualityStorageValue(
  quality: { id?: string; height?: number; bitrate?: number | null },
  auto: boolean,
): string {
  if (auto) {
    return "auto"
  }
  return quality.id || videoQualityLabel(quality)
}
