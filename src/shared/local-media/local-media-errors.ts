/**
 * Stable machine codes for local-media HTTP/WS failures.
 * User-facing copy lives in {@link localMediaErrorMessage}.
 */
export type LocalMediaErrorCode =
  | "not_found"
  | "owner_offline"
  | "provider_timeout"
  | "provider_unavailable"
  | "provider_read_failed"
  | "invalid_range"
  | "relay_failed"
  | "viewer_capability_denied"

export function localMediaErrorMessage(code: LocalMediaErrorCode): string {
  switch (code) {
    case "not_found":
      return "This local file is no longer available. Ask the sharer to add it again."
    case "owner_offline":
      return "The person sharing this file went offline. Playback pauses until they return and re-share it."
    case "provider_timeout":
      return "Timed out waiting for the file from the sharer. Keep their sharing tab open and try again."
    case "provider_unavailable":
      return "The sharer’s browser no longer has this file open. They need to share it again from the same tab."
    case "provider_read_failed":
      return "The sharer’s browser could not read this file. They may need to re-select it."
    case "invalid_range":
      return "Invalid media range request."
    case "relay_failed":
      return "Could not stream this local file through the server. Try again in a moment."
    case "viewer_capability_denied":
      return "This local file requires an active room session. Rejoin the room and try again."
  }
}

export function localMediaErrorFromMessage(
  message: string | undefined,
): LocalMediaErrorCode {
  const text = (message ?? "").toLowerCase()
  if (text.includes("timed out") || text.includes("timeout")) {
    return "provider_timeout"
  }
  if (text.includes("not_available") || text.includes("unavailable")) {
    return "provider_unavailable"
  }
  if (text.includes("read_failed") || text.includes("read failed")) {
    return "provider_read_failed"
  }
  if (text.includes("invalid") && text.includes("range")) {
    return "invalid_range"
  }
  if (text.includes("offline")) {
    return "owner_offline"
  }
  return "relay_failed"
}

export function httpStatusForLocalMediaError(code: LocalMediaErrorCode): number {
  switch (code) {
    case "not_found":
      return 404
    case "viewer_capability_denied":
      return 403
    case "invalid_range":
      return 416
    case "owner_offline":
    case "provider_timeout":
    case "provider_unavailable":
    case "provider_read_failed":
    case "relay_failed":
      return 503
  }
}
