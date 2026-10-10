"use client"

import { localMediaErrorMessage } from "@/shared/local-media/local-media-errors"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import {
  queryPlayerMediaElement,
  readMediaSeekableEndSec,
} from "@/shared/dom/player-utils"
import { resolveLiveEdgeSec } from "@/shared/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useCallback,
  useEffect,
  type RefObject,
} from "react"
import { toast } from "sonner"
import { useLatestRef } from "@/hooks/use-latest-ref"
import type { PlaylistItem, RoomState } from "@/contracts/types"
import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "@/client/player/pending-sync"
import { useApplyRoomClock } from "./use-apply-room-clock"
import { usePlaybackDriftCorrection } from "./use-playback-drift-correction"
import { usePlaybackSyncEngine } from "./use-playback-sync-engine"
import { usePlayerPresenceHeartbeat } from "./use-player-presence-heartbeat"
import { SEEK_ACK_MATCH_THRESHOLD_MS } from "../playback-control/use-playback-timeline-controller"

/**
 * Room-clock application, drift correction, and live-edge seek.
 *
 * Room clock writes must go through `engine.applyRoomClock` /
 * `engine.onAuthorityAnchor` only (see useApplyRoomClock +
 * usePlaybackDriftCorrection). Do not apply pending sync via ad-hoc seeks.
 */
export function usePlayerPlaybackSync(config: {
  playerRef: RefObject<MediaPlayerInstance | null>
  isMediaReadyRef: RefObject<boolean>
  bufferingSinceRef: RefObject<number | null>
  participantStatusErrorRef: RefObject<string | null>
  pendingSyncRef: RefObject<PendingSyncState | null>
  lastAppliedTimelineAnchorMsRef: RefObject<number | null>
  playbackRef: RefObject<RoomState["playback"]>
  playbackPausedRef: RefObject<boolean>
  reportedItemErrorRef: RefObject<string | null>
  proxyRenewAttemptedRef: RefObject<string | null>
  current: PlaylistItem | undefined
  activePlaybackSrc: string
  viewType: "audio" | "video"
  playerSrc: unknown
  /** Playback slice — not the full room (presence stays off this hook). */
  playback: RoomState["playback"]
  currentIndex: number
  /** Preselected boolean — avoids depending on the participants map. */
  ownerConnected: boolean
  send: TypedRoomEventSender
  canControlPlayback: boolean
  isBuffering: boolean
  playbackErrorLabel: string | undefined
  awaitingSeekTargetMs: number | null
  seekPhase: string
  timelineAnchorMs: number
  commitSeek: (targetMs: number) => void
}) {
  const {
    playerRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    playbackRef,
    playbackPausedRef,
    reportedItemErrorRef,
    proxyRenewAttemptedRef,
    current,
    activePlaybackSrc,
    viewType,
    playerSrc,
    playback,
    currentIndex,
    ownerConnected,
    send,
    canControlPlayback,
    isBuffering,
    playbackErrorLabel,
    awaitingSeekTargetMs,
    seekPhase,
    timelineAnchorMs,
    commitSeek,
  } = config

  const applyFailContextRef = useLatestRef({
    itemId: current?.id,
    itemName: current?.name,
    src: activePlaybackSrc,
    viewType,
  })

  const syncEngine = usePlaybackSyncEngine({
    playerRef,
    isMediaReadyRef,
    playbackPausedRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    playbackRef,
    onApplyFailed: (syncState) => {
      console.warn("[player] applyRoomClock failed", {
        ...applyFailContextRef.current,
        syncState,
      })
    },
  })

  const { applyRoomClock, clearTransportNudge } = useApplyRoomClock({
    engine: syncEngine,
  })

  useEffect(() => {
    if (!current) return
    if (current.sourceKind !== "local_file" || !current.localOriginUserId)
      return
    if (ownerConnected) return

    const player = playerRef.current
    try {
      player?.pause()
    } catch {
      // Ignore pause failures during remount/provider swaps.
    }

    if (reportedItemErrorRef.current === current.id) return
    reportedItemErrorRef.current = current.id
    toast.error(localMediaErrorMessage("owner_offline"))
  }, [current, ownerConnected, playerRef, reportedItemErrorRef])

  useEffect(() => {
    isMediaReadyRef.current = false
    pendingSyncRef.current = null
    lastAppliedTimelineAnchorMsRef.current = null
    bufferingSinceRef.current = Date.now()
    participantStatusErrorRef.current = null
    proxyRenewAttemptedRef.current = null
    syncEngine.reset()
    clearTransportNudge()
  }, [
    bufferingSinceRef,
    clearTransportNudge,
    current?.id,
    isMediaReadyRef,
    lastAppliedTimelineAnchorMsRef,
    participantStatusErrorRef,
    pendingSyncRef,
    playerSrc,
    proxyRenewAttemptedRef,
    syncEngine,
  ])

  const getCurrentTimeMs = useCallback(() => {
    const player = playerRef.current
    if (!player) {
      return 0
    }

    const mediaEl = queryPlayerMediaElement(player.el)
    const mediaTime = Number(mediaEl?.currentTime)
    if (Number.isFinite(mediaTime) && mediaTime >= 0) {
      return Math.max(0, Math.floor(mediaTime * 1000))
    }
    return Math.max(0, Math.floor(Number(player.currentTime ?? 0) * 1000))
  }, [playerRef])

  usePlaybackDriftCorrection({
    engine: syncEngine,
    holdLocalSeek:
      awaitingSeekTargetMs !== null || seekPhase === "previewing",
    timelineAnchorMs,
  })

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    const syncState = pendingSyncFromPlayback(playback)
    const shouldHoldForLocalSeek =
      awaitingSeekTargetMs !== null &&
      Math.abs(syncState.timelineAnchorMs - awaitingSeekTargetMs) >=
        SEEK_ACK_MATCH_THRESHOLD_MS
    if (shouldHoldForLocalSeek) {
      return
    }

    pendingSyncRef.current = syncState
    if (!isMediaReadyRef.current) {
      return
    }

    // Authority seeks must always apply — the default drift threshold can
    // skip small jumps and leave peers on the previous timeline.
    const anchorChanged =
      lastAppliedTimelineAnchorMsRef.current !== null &&
      lastAppliedTimelineAnchorMsRef.current !== syncState.timelineAnchorMs
    applyRoomClock(player, syncState, anchorChanged ? 0 : undefined)
  }, [
    applyRoomClock,
    awaitingSeekTargetMs,
    isMediaReadyRef,
    lastAppliedTimelineAnchorMsRef,
    pendingSyncRef,
    playback.paused,
    playback.playbackRate,
    playback.serverNowMs,
    playback.timelineAnchorMs,
    playback.videoLoop,
    playerRef,
  ])

  usePlayerPresenceHeartbeat({
    playerRef,
    participantStatusErrorRef,
    isBuffering,
    playbackErrorLabel,
    currentIndex,
    send,
  })

  const enforceServerPlaybackState = useCallback(() => {
    const player = playerRef.current
    if (!player || !isMediaReadyRef.current) {
      return
    }

    applyRoomClock(player, pendingSyncFromPlayback(playbackRef.current))
  }, [applyRoomClock, isMediaReadyRef, playbackRef, playerRef])

  const commitLiveEdgeSeek = useCallback(() => {
    if (!canControlPlayback) {
      enforceServerPlaybackState()
      return
    }
    const player = playerRef.current
    if (!player) {
      return
    }

    let seekableEnd = Number(player.state.seekableEnd)
    const liveSyncPosition =
      player.state.liveSyncPosition === null ||
      player.state.liveSyncPosition === undefined
        ? null
        : Number(player.state.liveSyncPosition)

    // Prefer the media element's finite DVR window — Vidstack often keeps
    // store seekableEnd at Infinity for live HLS.
    const media = queryPlayerMediaElement(player.el)
    const elementEnd = readMediaSeekableEndSec(media)
    if (elementEnd !== null) {
      seekableEnd = elementEnd
    }

    const edgeSec = resolveLiveEdgeSec({
      seekableEnd,
      liveSyncPosition,
    })
    if (edgeSec === null) {
      return
    }
    // Optimistic local seek: live Vidstack wrappers often no-op currentTime
    // while canSeek is false; the media element still accepts DVR seeks.
    try {
      player.currentTime = edgeSec
      if (media) {
        media.currentTime = edgeSec
      }
    } catch {
      // Room commit below remains the authority.
    }
    commitSeek(Math.floor(edgeSec * 1000))
  }, [
    canControlPlayback,
    commitSeek,
    enforceServerPlaybackState,
    playerRef,
  ])

  // Vidstack's LiveButton no-ops when its store thinks `liveEdge` is already
  // true (common with Infinity seekableEnd / DVR lag). Capture the click so
  // room sync still jumps to the real media seekable end.
  useEffect(() => {
    if (!canControlPlayback) {
      return
    }
    const onClickCapture = (event: Event) => {
      const target = event.target
      if (!(target instanceof Element)) {
        return
      }
      const liveButton = target.closest(
        '[aria-label="Skip To Live"], [data-media-tooltip="live"]',
      )
      if (!liveButton) {
        return
      }
      commitLiveEdgeSeek()
    }
    document.addEventListener("click", onClickCapture, true)
    return () => document.removeEventListener("click", onClickCapture, true)
  }, [canControlPlayback, commitLiveEdgeSeek])

  return {
    applyRoomClock,
    getCurrentTimeMs,
    enforceServerPlaybackState,
    commitLiveEdgeSeek,
  }
}
