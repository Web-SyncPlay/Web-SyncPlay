export function formatClockMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`
}

export function formatRelativeLastSeen(timestamp?: number): string {
  if (!timestamp) {
    return "unknown"
  }

  const deltaMs = Date.now() - timestamp
  if (deltaMs < 2000) {
    return "just now"
  }

  const deltaSec = Math.floor(deltaMs / 1000)
  if (deltaSec < 60) {
    return `${deltaSec}s ago`
  }

  const deltaMin = Math.floor(deltaSec / 60)
  if (deltaMin < 60) {
    return `${deltaMin}m ago`
  }

  const deltaHr = Math.floor(deltaMin / 60)
  return `${deltaHr}h ago`
}
