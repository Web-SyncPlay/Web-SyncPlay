"use client"

import { localMediaErrorMessage } from "@/lib/local-media-errors"
import { getAdjacentPlaylistIndex } from "@/lib/playback-sync"
import type { TypedRoomEventSender } from "@/lib/room-events"
import type {
  MediaErrorDetail,
  MediaPlayerInstance,
} from "@vidstack/react"
import type { RefObject } from "react"
import { toast } from "sonner"
import type { LoopMode, PlaylistItem, RoomState } from "@/zod/types"
import {
  formatMediaErrorDetail,
  mediaErrorCode,
  type PlayerSrcInput,
} from "../player-src"
import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "./use-buffering-watchdog"
import {
  SEEK_ACK_MATCH_THRESHOLD_MS,
  type LocalSeekPhase,
} from "../playback-control/use-playback-timeline-controller"

/** Playlist nav fields read from a ref so ended logic avoids prop churn. */
export type PlaylistNavSnapshot = {
  currentIndex: number
  playlistLoop: LoopMode
}

export type SyncedMediaPlayerHandlerDeps = {
  playerRef: RefObject<MediaPlayerInstance | null>
  current: PlaylistItem | undefined
  playerSrc: PlayerSrcInput
  activePlaybackSrc: string
  send: TypedRoomEventSender
  canControlPlayback: boolean
  isMuted: boolean
  preferredVolume: number
  unmute: () => number
  handleVolumeChange: (detail: { volume: number; muted: boolean }) => void
  playbackRef: RefObject<RoomState["playback"]>
  playlistNavRef: RefObject<PlaylistNavSnapshot>
  isMediaReadyRef: RefObject<boolean>
  bufferingSinceRef: RefObject<number | null>
  participantStatusErrorRef: RefObject<string | null>
  pendingSyncRef: RefObject<PendingSyncState | null>
  reportedItemErrorRef: RefObject<string | null>
  reportedDurationItemIdRef: RefObject<string | null>
  proxyRenewAttemptedRef: RefObject<string | null>
  localBlobFallbackAttemptedRef: RefObject<string | null>
  seekPhase: LocalSeekPhase
  awaitingSeekTargetMs: number | null
  totalItems: number
  userId: string
  applyRoomClock: (
    player: MediaPlayerInstance,
    syncState: PendingSyncState,
    driftThresholdSec?: number,
  ) => void
  enforceServerPlaybackState: () => void
  getCurrentTimeMs: () => number
  commitLiveEdgeSeek: () => void
  selectPlaylistIndex: (index: number) => void
  beginSeek: (targetMs: number) => void
  updateSeek: (targetMs: number) => void
  commitSeek: (targetMs: number) => void
  setIsBuffering: (value: boolean) => void
  setPlaybackError: (value: MediaErrorDetail | undefined) => void
  setMediaDurationMs: (value: number) => void
  setForceLocalRelaySrc: (value: boolean) => void
  setPlayerRemountNonce: (updater: (n: number) => number) => void
}

/** MediaPlayer event handlers for SyncedMediaPlayer (plain object; React Compiler). */
export function useSyncedMediaPlayerHandlers(deps: SyncedMediaPlayerHandlerDeps) {
  const {
    playerRef,
    current,
    playerSrc,
    activePlaybackSrc,
    send,
    canControlPlayback,
    isMuted,
    preferredVolume,
    unmute,
    handleVolumeChange,
    playbackRef,
    playlistNavRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    reportedItemErrorRef,
    reportedDurationItemIdRef,
    proxyRenewAttemptedRef,
    localBlobFallbackAttemptedRef,
    seekPhase,
    awaitingSeekTargetMs,
    totalItems,
    userId,
    applyRoomClock,
    enforceServerPlaybackState,
    getCurrentTimeMs,
    commitLiveEdgeSeek,
    selectPlaylistIndex,
    beginSeek,
    updateSeek,
    commitSeek,
    setIsBuffering,
    setPlaybackError,
    setMediaDurationMs,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
  } = deps

  return {
    onKeyDownCapture: (event: { key: string; preventDefault: () => void; stopPropagation: () => void }) => {
      if (canControlPlayback) {
        return
      }
      const key = event.key.toLowerCase()
      const allowedGuestKeys = new Set(["m", "arrowup", "arrowdown"])
      if (allowedGuestKeys.has(key)) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
    },
    onMediaPlayRequest: (event: { preventDefault: () => void }) => {
      // Room playback owns transport. Never let Vidstack gestures/buttons
      // toggle the element locally — that races with onPause enforce and
      // causes click-pause → brief spinner → resume, then desync.
      event.preventDefault()
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      if (playbackRef.current.paused) {
        send("playback:play", { currentTimeMs: getCurrentTimeMs() })
      }
    },
    onMediaPauseRequest: (event: { preventDefault: () => void }) => {
      event.preventDefault()
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      if (!playbackRef.current.paused) {
        send("playback:pause", { currentTimeMs: getCurrentTimeMs() })
      }
    },
    onMediaSeekingRequest: (detail: unknown) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      const targetSec = Number(detail)
      if (!Number.isFinite(targetSec)) {
        commitLiveEdgeSeek()
        return
      }
      const targetMs = Math.max(0, Math.floor(targetSec * 1000))
      if (seekPhase === "idle") {
        beginSeek(targetMs)
        return
      }
      updateSeek(targetMs)
    },
    onMediaSeekRequest: (detail: unknown) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      const targetSec = Number(detail)
      if (!Number.isFinite(targetSec)) {
        commitLiveEdgeSeek()
        return
      }
      commitSeek(Math.max(0, Math.floor(targetSec * 1000)))
    },
    onMediaLiveEdgeRequest: () => {
      commitLiveEdgeSeek()
    },
    onMediaRateChangeRequest: (detail: unknown) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }
      const nextRate = Number(detail)
      if (!Number.isFinite(nextRate)) {
        return
      }
      if (Math.abs(nextRate - playbackRef.current.playbackRate) < 0.001) {
        return
      }
      send("playback:rate", { playbackRate: nextRate })
    },
    onPlay: () => {
      setIsBuffering(false)
      setPlaybackError(undefined)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      if (!canControlPlayback && playbackRef.current.paused) {
        enforceServerPlaybackState()
      }
    },
    onPause: () => {
      setIsBuffering(false)
      bufferingSinceRef.current = null
      // Unexpected provider pauses must not stick while room says playing.
      // User gestures are preventDefault'd above, so this only recovers
      // provider drift — not a controller click that already sent pause.
      if (!playbackRef.current.paused) {
        enforceServerPlaybackState()
      }
    },
    onPlaying: () => {
      setIsBuffering(false)
      setPlaybackError(undefined)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      if (
        current &&
        canControlPlayback &&
        (current.ingestStatus === "error" || Boolean(current.ingestError))
      ) {
        reportedItemErrorRef.current = null
        send("playlist:item:error", {
          itemId: current.id,
          error: null,
        })
      }
    },
    onWaiting: () => {
      setIsBuffering(true)
      if (bufferingSinceRef.current === null) {
        bufferingSinceRef.current = Date.now()
      }
    },
    onLoadStart: () => {
      isMediaReadyRef.current = false
      setIsBuffering(true)
      bufferingSinceRef.current = Date.now()
    },
    onCanPlay: () => {
      isMediaReadyRef.current = true
      setIsBuffering(false)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null
      const player = playerRef.current
      if (!player) {
        return
      }

      const pending =
        pendingSyncRef.current ??
        pendingSyncFromPlayback(playbackRef.current)

      const pendingToApply =
        awaitingSeekTargetMs !== null &&
        Math.abs(pending.timelineAnchorMs - awaitingSeekTargetMs) >=
          SEEK_ACK_MATCH_THRESHOLD_MS
          ? {
              ...pending,
              paused: Boolean(player.paused),
              timelineAnchorMs: awaitingSeekTargetMs,
              serverNowMs: Date.now(),
            }
          : pending
      // Force-snap after canplay — HLS often becomes seekable only here.
      applyRoomClock(player, pendingToApply, 0)
      // Providers may reset volume on load; re-apply preferred level.
      if (Math.abs(player.volume - preferredVolume) > 0.001) {
        player.volume = preferredVolume
      }
      if (player.muted !== isMuted) {
        player.muted = isMuted
      }
    },
    onError: (detail: MediaErrorDetail) => {
      setIsBuffering(false)
      participantStatusErrorRef.current = null
      bufferingSinceRef.current = null

      const message = formatMediaErrorDetail(detail)
      const errorCode = mediaErrorCode(detail)
      const isProviderLocalBlob =
        current?.sourceKind === "local_file" &&
        current.localOriginUserId === userId &&
        activePlaybackSrc.startsWith("blob:")

      // Host blob: path failed — retry once via the HTTP relay viewers use.
      if (
        isProviderLocalBlob &&
        current &&
        localBlobFallbackAttemptedRef.current !== current.id
      ) {
        localBlobFallbackAttemptedRef.current = current.id
        console.warn(
          "[player] local blob src failed; falling back to relay URL",
          { itemId: current.id, errorCode, message },
        )
        setPlaybackError(undefined)
        setForceLocalRelaySrc(true)
        setPlayerRemountNonce((n) => n + 1)
        return
      }

      setPlaybackError(detail)

      const usesProxyPath =
        activePlaybackSrc.includes("/api/media/proxy/") ||
        (current?.playableUrl?.includes("/api/media/proxy/") ?? false)
      const looksExpiredOrMissing =
        /\b(401|403|404|409)\b/i.test(message) ||
        /not found|expired|upstream_expired|failed to fetch upstream/i.test(
          message,
        )

      const localFileUserMessage = (() => {
        if (current?.sourceKind !== "local_file") return null
        // Host still on blob (shouldn't reach here after fallback) —
        // don't mislabel as a relay failure.
        if (isProviderLocalBlob) {
          return "Could not play this local file in your browser. Try a different format (e.g. MP4/H.264)."
        }
        const lower = message.toLowerCase()
        if (/\b404\b/.test(message) || lower.includes("not found")) {
          return localMediaErrorMessage("not_found")
        }
        if (/\b503\b/.test(message) || lower.includes("unavailable")) {
          if (lower.includes("offline")) {
            return localMediaErrorMessage("owner_offline")
          }
          if (lower.includes("timed out") || lower.includes("timeout")) {
            return localMediaErrorMessage("provider_timeout")
          }
          return localMediaErrorMessage("provider_unavailable")
        }
        return localMediaErrorMessage("relay_failed")
      })()

      if (
        current &&
        canControlPlayback &&
        current.sourceKind === "remote_url" &&
        usesProxyPath &&
        looksExpiredOrMissing &&
        proxyRenewAttemptedRef.current !== current.id
      ) {
        proxyRenewAttemptedRef.current = current.id
        send("playlist:retry", { itemId: current.id })
        setPlaybackError(undefined)
        console.warn("[player] proxy URL stale; requested playlist retry", {
          itemId: current.id,
        })
        return
      }

      if (
        current &&
        canControlPlayback &&
        current.ingestStatus !== "resolving" &&
        reportedItemErrorRef.current !== current.id
      ) {
        reportedItemErrorRef.current = current.id
        const userMessage = localFileUserMessage ?? message
        toast.error(userMessage)
        send("playlist:item:error", {
          itemId: current.id,
          error: userMessage,
        })
      }
      console.error("[player] playback error", {
        detail,
        message,
        userMessage: localFileUserMessage ?? message,
        sourceKind: current?.sourceKind,
        source: activePlaybackSrc,
        playerSrc,
      })
    },
    onVolumeChange: (detail: { volume: number; muted: boolean }) => {
      // Native mute toggle: restore preferred volume so unmute is never 100% by default.
      if (!detail.muted && isMuted) {
        const player = playerRef.current
        const volume = unmute()
        if (player) {
          player.volume = volume
          player.muted = false
        }
        return
      }
      handleVolumeChange(detail)
    },
    onMediaUserLoopChangeRequest: (detail: boolean) => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }

      const nextMode = detail ? "always" : "off"
      if (nextMode === playbackRef.current.videoLoop) {
        return
      }

      send("playback:loop:video", { mode: nextMode })
    },
    onEnded: () => {
      if (!canControlPlayback) {
        enforceServerPlaybackState()
        return
      }

      // HTML `loop` already restarts when videoLoop is on.
      if (playbackRef.current.videoLoop !== "off") {
        return
      }

      const { currentIndex, playlistLoop } = playlistNavRef.current
      const nextIndex = getAdjacentPlaylistIndex({
        currentIndex,
        totalItems,
        loopMode: playlistLoop,
        direction: "next",
      })
      if (nextIndex === null) {
        // Pause at EOF so declarative autoPlay + sync don't thrash the
        // last few frames while the room is still "playing".
        if (!playbackRef.current.paused) {
          send("playback:pause", {
            currentTimeMs: getCurrentTimeMs(),
          })
        }
        return
      }

      selectPlaylistIndex(nextIndex)
    },
    onDurationChange: (detail: unknown) => {
      const durationSec = Number(detail)
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        setMediaDurationMs(0)
        return
      }

      setMediaDurationMs(Math.floor(durationSec * 1000))

      // Fill room catalog so headless control pages get a finite duration.
      const item = current
      if (!item || item.isLive === true) {
        return
      }
      const catalogSec = Number(item.durationSeconds)
      if (Number.isFinite(catalogSec) && catalogSec > 0) {
        return
      }
      if (reportedDurationItemIdRef.current === item.id) {
        return
      }
      reportedDurationItemIdRef.current = item.id
      send("playlist:item:duration", {
        itemId: item.id,
        durationSeconds: Math.round(durationSec),
      })
    },
  }
}
