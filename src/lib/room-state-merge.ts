import type {
  PresenceBatchPayload,
  PresencePatch,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
} from "@/zod/types"

function pickDefined<T>(
  patchValue: T | undefined,
  existing: T,
): T {
  return patchValue !== undefined ? patchValue : existing
}

function mergeParticipantPresence(
  prev: RoomState["participants"],
  patches: Record<string, PresencePatch>,
): RoomState["participants"] {
  let changed = false
  const next = { ...prev }
  for (const [userId, patch] of Object.entries(patches)) {
    const existing = next[userId]
    if (!existing) continue
    next[userId] = {
      ...existing,
      connected: pickDefined(patch.connected, existing.connected),
      lastSeenAt: pickDefined(patch.lastSeenAt, existing.lastSeenAt),
      disconnectedAt: pickDefined(patch.disconnectedAt, existing.disconnectedAt),
      username: pickDefined(patch.username, existing.username),
      avatarStyle: pickDefined(patch.avatarStyle, existing.avatarStyle),
      localPlayback: patch.localPlayback ?? existing.localPlayback,
    }
    changed = true
  }
  return changed ? next : prev
}

/**
 * Control patches carry `currentIndex` without the playlist. When the playlist
 * is still stale (snapshot pending), a remapped index can point at the wrong
 * neighbor. Prefer the stable `playback.mediaId` identity when they disagree.
 */
function reconcileControlCurrentIndex(
  prev: RoomState,
  payload: RoomControlPayload,
): number {
  const mediaId = payload.playback.mediaId
  if (!mediaId) {
    return payload.currentIndex
  }
  if (prev.playlist[payload.currentIndex]?.id === mediaId) {
    return payload.currentIndex
  }
  const byMediaId = prev.playlist.findIndex((item) => item.id === mediaId)
  return byMediaId >= 0 ? byMediaId : prev.currentIndex
}

export function applyRoomControl(
  prev: RoomState | null,
  payload: RoomControlPayload,
): RoomState | null {
  if (!prev) return prev
  const localGen = prev.generation ?? 0
  if (payload.generation < localGen) {
    return prev
  }
  return {
    ...prev,
    playback: payload.playback,
    currentIndex: reconcileControlCurrentIndex(prev, payload),
    updatedAt: payload.updatedAt,
    generation: payload.generation,
  }
}

export function applyPresenceBatch(
  prev: RoomState | null,
  payload: PresenceBatchPayload,
): RoomState | null {
  if (!prev) return prev
  const participants = mergeParticipantPresence(
    prev.participants,
    payload.participants,
  )
  if (participants === prev.participants) {
    return prev
  }
  return {
    ...prev,
    participants,
  }
}

/** Fold several presence envelopes in arrival order (one React update). */
export function applyPresenceBatches(
  prev: RoomState | null,
  payloads: readonly PresenceBatchPayload[],
): RoomState | null {
  let next = prev
  for (const payload of payloads) {
    next = applyPresenceBatch(next, payload)
  }
  return next
}

export type PresenceCoalesceCancel = () => void

export type PresenceCoalesceSchedule = (
  flush: () => void,
) => PresenceCoalesceCancel

/**
 * Default: one flush per animation frame; falls back to a microtask when rAF
 * is unavailable (tests / non-DOM).
 */
export const schedulePresenceCoalesce: PresenceCoalesceSchedule = (flush) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => {
      flush()
    })
    return () => {
      cancelAnimationFrame(id)
    }
  }
  let cancelled = false
  queueMicrotask(() => {
    if (!cancelled) flush()
  })
  return () => {
    cancelled = true
  }
}

export type PresenceBatchCoalescer = {
  enqueue: (payload: PresenceBatchPayload) => void
  /** Drop pending batches and cancel a scheduled flush (socket teardown). */
  dispose: () => void
  /** Test helper: how many envelopes are waiting for the next flush. */
  pendingCount: () => number
}

/**
 * Coalesce rapid `presence:batch` envelopes into a single flush per frame/turn.
 * Callers should apply the flushed payloads via `startTransition` so presence
 * yields to urgent `room:control` / snapshot updates.
 */
export function createPresenceBatchCoalescer(options: {
  onFlush: (payloads: PresenceBatchPayload[]) => void
  schedule?: PresenceCoalesceSchedule
}): PresenceBatchCoalescer {
  const schedule = options.schedule ?? schedulePresenceCoalesce
  let pending: PresenceBatchPayload[] = []
  let cancelScheduled: PresenceCoalesceCancel | null = null

  const flush = () => {
    cancelScheduled = null
    if (pending.length === 0) return
    const payloads = pending
    pending = []
    options.onFlush(payloads)
  }

  return {
    enqueue(payload) {
      pending.push(payload)
      if (cancelScheduled) return
      cancelScheduled = schedule(flush)
    },
    dispose() {
      cancelScheduled?.()
      cancelScheduled = null
      pending = []
    },
    pendingCount() {
      return pending.length
    },
  }
}

export function applyRoomSnapshot(
  prev: RoomState | null,
  payload: RoomSnapshotPayload,
): RoomState {
  if (!prev) {
    return payload
  }

  const localGen = prev.generation ?? 0
  const applyPlayback = payload.generation >= localGen

  // Preserve ephemeral seek preview from a newer/equal control patch.
  let playback = applyPlayback ? payload.playback : prev.playback
  if (
    applyPlayback &&
    prev.playback.seekPreview?.active &&
    !payload.playback.seekPreview?.active &&
    (prev.generation ?? 0) >= payload.generation
  ) {
    playback = {
      ...playback,
      seekPreview: prev.playback.seekPreview,
    }
  }

  return {
    ...payload,
    playback,
    currentIndex: applyPlayback ? payload.currentIndex : prev.currentIndex,
    generation: Math.max(localGen, payload.generation ?? 0),
    structuralRevision: Math.max(
      prev.structuralRevision ?? 0,
      payload.structuralRevision ?? 0,
    ),
  }
}
