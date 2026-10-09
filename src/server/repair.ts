import { env } from "@/env"
import {
  createDefaultRoomSecurity,
  normalizeDefaultJoinRole,
} from "@/server/realtime/services/room-security"
import {
  roomActionLogMaxAgeMs,
  type PlaybackState,
  type PlaylistItem,
  type RoomState,
} from "@/zod/types"
import { randomUUID } from "node:crypto"
import { pruneActionLog, trackedActionTypes } from "./log"

export function normalizeFiniteNumber(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback
  }

  return value
}

export function repairCleanupAndCheckRoomState(state: RoomState) {
  const findings: string[] = []

  if (!state.roomId || typeof state.roomId !== "string") {
    findings.push("room-id-invalid")
  }
  if (!state.ownerId || typeof state.ownerId !== "string") {
    state.ownerId = randomUUID()
    findings.push("owner-repaired")
  }
  if (!state.roomSecurity || typeof state.roomSecurity !== "object") {
    state.roomSecurity = createDefaultRoomSecurity()
    findings.push("room-security-repaired")
  } else {
    state.roomSecurity = {
      ...createDefaultRoomSecurity(),
      ...state.roomSecurity,
      joinPasswordEnabled: state.roomSecurity.joinPasswordEnabled === true,
      joinPasswordUpdatedAt:
        typeof state.roomSecurity.joinPasswordUpdatedAt === "number" &&
        Number.isFinite(state.roomSecurity.joinPasswordUpdatedAt)
          ? state.roomSecurity.joinPasswordUpdatedAt
          : null,
      admissionVersion:
        typeof state.roomSecurity.admissionVersion === "number" &&
        Number.isInteger(state.roomSecurity.admissionVersion) &&
        state.roomSecurity.admissionVersion >= 0
          ? state.roomSecurity.admissionVersion
          : 0,
      defaultJoinRole: normalizeDefaultJoinRole(
        state.roomSecurity.defaultJoinRole,
      ),
    }
    if (
      state.roomSecurity.joinPasswordEnabled &&
      (!state.roomSecurity.joinPasswordHash ||
        !state.roomSecurity.joinPasswordSalt)
    ) {
      state.roomSecurity.joinPasswordEnabled = false
      state.roomSecurity.joinPasswordHash = undefined
      state.roomSecurity.joinPasswordSalt = undefined
      findings.push("room-security-disabled-missing-secret")
    }
  }

  findings.push(...repairPlaylistState(state))

  if (!state.participants || typeof state.participants !== "object") {
    state.participants = {}
    findings.push("participants-repaired")
  }

  const participantEntries = Object.entries(state.participants).filter(
    ([userId, participant]) =>
      typeof userId === "string" &&
      userId.length > 0 &&
      participant &&
      typeof participant === "object" &&
      typeof participant.userId === "string",
  )
  if (participantEntries.length !== Object.keys(state.participants).length) {
    findings.push("participants-cleaned")
  }
  state.participants = Object.fromEntries(
    participantEntries.slice(0, env.ROOM_PARTICIPANTS_LIMIT),
  )
  for (const participant of Object.values(state.participants)) {
    if (
      typeof participant.joinedAt !== "number" ||
      !Number.isFinite(participant.joinedAt) ||
      participant.joinedAt <= 0
    ) {
      const fallbackJoinedAt =
        (typeof participant.connectedAt === "number" &&
        participant.connectedAt > 0
          ? participant.connectedAt
          : undefined) ??
        (typeof participant.lastSeenAt === "number" &&
        participant.lastSeenAt > 0
          ? participant.lastSeenAt
          : undefined) ??
        Date.now()
      participant.joinedAt = fallbackJoinedAt
      findings.push("participant-joined-at-repaired")
    }
  }
  if (participantEntries.length > env.ROOM_PARTICIPANTS_LIMIT) {
    findings.push("participants-trimmed")
  }

  if (!Array.isArray(state.actionLog)) {
    state.actionLog = []
    findings.push("action-log-repaired")
  } else {
    const beforeLength = state.actionLog.length
    const now = Date.now()
    const cutoff = now - roomActionLogMaxAgeMs
    const valid = state.actionLog.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.action === "string" &&
        typeof entry.actorUserId === "string" &&
        typeof entry.at === "number" &&
        entry.at >= cutoff &&
        trackedActionTypes.has(entry.action),
    )
    if (valid.length !== beforeLength) {
      findings.push("action-log-filtered")
    }
    const pruned = pruneActionLog(valid, now)
    if (pruned.length < valid.length) {
      findings.push("action-log-trimmed")
    }
    state.actionLog = pruned
  }

  if (!state.playback || typeof state.playback !== "object") {
    state.playback = createDefaultPlayback()
    findings.push("playback-object-repaired")
  }

  const playbackRepairs = sanitizePlayback(state)
  for (let i = 0; i < playbackRepairs; i += 1)
    findings.push("playback-repaired")

  // Strip legacy fields removed from the schema so Redis payloads converge.
  const legacyState = state as RoomState & { history?: unknown }
  if ("history" in legacyState) {
    delete legacyState.history
    findings.push("legacy-history-stripped")
  }
  const legacyPlayback = state.playback as typeof state.playback & {
    shuffle?: unknown
  }
  if ("shuffle" in legacyPlayback) {
    delete legacyPlayback.shuffle
    findings.push("legacy-shuffle-stripped")
  }

  if (state.updatedAt <= 0 || !Number.isFinite(state.updatedAt)) {
    state.updatedAt = Date.now()
    findings.push("updated-at-repaired")
  }

  if (
    typeof state.generation !== "number" ||
    !Number.isFinite(state.generation) ||
    state.generation < 0
  ) {
    state.generation = 0
    findings.push("generation-repaired")
  }

  if (
    typeof state.structuralRevision !== "number" ||
    !Number.isFinite(state.structuralRevision) ||
    state.structuralRevision < 0
  ) {
    state.structuralRevision = 0
    findings.push("structural-revision-repaired")
  }

  return findings
}

type LegacyPlaylistItem = PlaylistItem & {
  isResolving?: boolean
  resolutionError?: string
  originalUrl?: string
  selectedStreamId?: string
  selectedTextTrackId?: string
}

/** Normalize playlist shape, migrate legacy item fields, clamp index, trim overflow. */
export function repairPlaylistState(state: RoomState): string[] {
  const findings: string[] = []

  if (!Array.isArray(state.playlist)) {
    state.playlist = []
    findings.push("playlist-repaired")
  }
  state.playlist = state.playlist.filter(
    (item) =>
      item &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.sourceUrl === "string" &&
      typeof item.playableUrl === "string",
  )

  for (const item of state.playlist) {
    findings.push(...repairPlaylistItemFields(item))
  }

  if (state.currentIndex >= state.playlist.length) {
    state.currentIndex = Math.max(0, state.playlist.length - 1)
    findings.push("playlist-index-clamped")
  }
  if (state.currentIndex < 0 || !Number.isInteger(state.currentIndex)) {
    state.currentIndex = 0
    findings.push("playlist-index-repaired")
  }

  if (state.playlist.length > env.ROOM_PLAYLIST_LIMIT) {
    const overflow = state.playlist.length - env.ROOM_PLAYLIST_LIMIT
    state.playlist = state.playlist.slice(-env.ROOM_PLAYLIST_LIMIT)
    state.currentIndex = Math.max(
      0,
      Math.min(state.currentIndex - overflow, state.playlist.length - 1),
    )
    findings.push("playlist-trimmed")
  }

  return findings
}

function repairPlaylistItemFields(item: PlaylistItem): string[] {
  const findings: string[] = []
  const legacy = item as LegacyPlaylistItem

  if (item.sourceKind !== "remote_url" && item.sourceKind !== "local_file") {
    item.sourceKind = item.localMediaId ? "local_file" : "remote_url"
    findings.push("playlist-item-source-kind-repaired")
  }
  if (item.playbackMode !== "direct" && item.playbackMode !== "relay") {
    item.playbackMode = "direct"
    findings.push("playlist-item-playback-mode-repaired")
  }
  // Local files are same-origin — never "relay"
  if (item.sourceKind === "local_file" && item.playbackMode === "relay") {
    item.playbackMode = "direct"
    findings.push("playlist-item-local-playback-mode-repaired")
  }

  if (
    item.ingestStatus !== "ready" &&
    item.ingestStatus !== "resolving" &&
    item.ingestStatus !== "error"
  ) {
    item.ingestStatus = legacy.isResolving
      ? "resolving"
      : legacy.resolutionError
        ? "error"
        : "ready"
    findings.push("playlist-item-ingest-status-repaired")
  }
  if (!item.ingestError && typeof legacy.resolutionError === "string") {
    item.ingestError = legacy.resolutionError
    findings.push("playlist-item-ingest-error-migrated")
  }
  if (!item.defaultStreamId && typeof legacy.selectedStreamId === "string") {
    item.defaultStreamId = legacy.selectedStreamId
    findings.push("playlist-item-default-stream-migrated")
  }
  if (
    !item.defaultTextTrackId &&
    typeof legacy.selectedTextTrackId === "string"
  ) {
    item.defaultTextTrackId = legacy.selectedTextTrackId
    findings.push("playlist-item-default-text-track-migrated")
  }

  // Strip legacy dual-write fields (persisted rooms lose these on join repair).
  delete legacy.isResolving
  delete legacy.resolutionError
  delete legacy.originalUrl
  delete legacy.selectedStreamId
  delete legacy.selectedTextTrackId

  return findings
}

/** Safe default when Redis payloads lack a playback object. */
export function createDefaultPlayback(nowMs = Date.now()): PlaybackState {
  return {
    paused: true,
    playbackRate: 1,
    timelineAnchorMs: 0,
    serverNowMs: nowMs,
    videoLoop: "off",
    playlistLoop: "off",
  }
}

export function sanitizePlayback(state: RoomState) {
  let repairs = 0
  if (!state.playback || typeof state.playback !== "object") {
    state.playback = createDefaultPlayback()
    return 1
  }

  state.playback.paused = Boolean(state.playback.paused)
  state.playback.playbackRate = Math.min(
    3,
    Math.max(0.25, normalizeFiniteNumber(state.playback.playbackRate, 1)),
  )
  state.playback.timelineAnchorMs = Math.max(
    0,
    normalizeFiniteNumber(state.playback.timelineAnchorMs, 0),
  )
  state.playback.serverNowMs = Math.max(
    0,
    normalizeFiniteNumber(state.playback.serverNowMs, Date.now()),
  )

  if (
    state.playback.videoLoop !== "off" &&
    state.playback.videoLoop !== "once" &&
    state.playback.videoLoop !== "always"
  ) {
    state.playback.videoLoop = "off"
    repairs += 1
  }

  if (
    state.playback.playlistLoop !== "off" &&
    state.playback.playlistLoop !== "once" &&
    state.playback.playlistLoop !== "always"
  ) {
    state.playback.playlistLoop = "off"
    repairs += 1
  }

  return repairs
}
