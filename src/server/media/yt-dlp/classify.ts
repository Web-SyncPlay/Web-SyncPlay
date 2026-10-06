export type YtDlpFailureClassification =
  | "not_live"
  | "not_found"
  | "login_required"
  | "network"
  | "timeout"
  | "binary_missing"
  | "unknown"

const NOT_LIVE_PATTERNS = [
  /not(?:\s+\w+){0,2}\s+live/i,
  /offline/i,
  /UserNotLive/i,
  /does not have a live stream/i,
  /stream is offline/i,
]

const NOT_FOUND_PATTERNS = [
  /does not exist/i,
  /Video .* does not exist/i,
  /Channel .* not found/i,
  /HTTP Error 404/i,
]

const LOGIN_PATTERNS = [
  /login/i,
  /authentication/i,
  /private video/i,
  /members only/i,
]

const NETWORK_PATTERNS = [
  /timed out/i,
  /timeout/i,
  /Connection refused/i,
  /Name or service not known/i,
  /Unable to download/i,
  /HTTP Error 403/i,
]

export function classifyYtDlpStderr(stderr: string): {
  classification: YtDlpFailureClassification
  userMessage: string
} {
  const text = stderr.trim()
  if (!text) {
    return {
      classification: "unknown",
      userMessage: "Could not resolve media from this URL.",
    }
  }

  if (NOT_LIVE_PATTERNS.some((re) => re.test(text))) {
    return {
      classification: "not_live",
      userMessage:
        "This channel is not live right now. Try a VOD URL or wait until the stream is online.",
    }
  }
  if (NOT_FOUND_PATTERNS.some((re) => re.test(text))) {
    return {
      classification: "not_found",
      userMessage: "Video or channel was not found.",
    }
  }
  if (LOGIN_PATTERNS.some((re) => re.test(text))) {
    return {
      classification: "login_required",
      userMessage: "This content may require login or permissions.",
    }
  }
  if (NETWORK_PATTERNS.some((re) => re.test(text))) {
    return {
      classification: "network",
      userMessage: "Network error while resolving media. Try again.",
    }
  }

  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? text
  const snippet =
    firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine
  return {
    classification: "unknown",
    userMessage: snippet,
  }
}

export function classifyYtDlpRunFailure(input: {
  stderr: string
  failureKind?: "timeout" | "spawn_error" | "truncated" | null
  spawnErrorCode?: string
}): {
  classification: YtDlpFailureClassification
  userMessage: string
} {
  if (input.failureKind === "timeout") {
    return {
      classification: "timeout",
      userMessage: "Timed out while resolving media. Try again.",
    }
  }
  if (input.failureKind === "spawn_error") {
    if (input.spawnErrorCode === "ENOENT") {
      return {
        classification: "binary_missing",
        userMessage: "Media resolver is not available on this server.",
      }
    }
    return {
      classification: "unknown",
      userMessage: "Could not start media resolver on this server.",
    }
  }
  if (input.failureKind === "truncated") {
    return {
      classification: "unknown",
      userMessage: "Media metadata from this URL was too large to process.",
    }
  }
  return classifyYtDlpStderr(input.stderr)
}
