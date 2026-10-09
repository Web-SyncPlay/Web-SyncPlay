"use client"

import { localMediaErrorMessage } from "@/lib/local-media-errors"
import type { TypedRoomEventSender } from "@/lib/room-events"
import {
  queryPlayerMediaElement,
  readMediaSeekableEndSec,
  resolveLiveEdgeSec,
} from "@/lib/player-utils"
import type { MediaPlayerInstance } from "@vidstack/react"
import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react"
import { toast } from "sonner"
import type { PlaylistItem, RoomState } from "@/zod/types"
import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "./use-buffering-watchdog"
import { useApplyRoomClock } from "./use-apply-room-clock"
import { usePlaybackDriftCorrection } from "./use-playback-drift-correction"
import { SEEK_ACK_MATCH_THRESHOLD_MS } from "../playback-control/use-playback-timeline-controller"

/**
 * Room-clock application, drift correction, presence heartbeat, and live-edge seek.
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
  roomState: RoomState
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
    roomState,
    send,
    canControlPlayback,
    isBuffering,
    playbackErrorLabel,
    awaitingSeekTargetMs,
    seekPhase,
    timelineAnchorMs,
    commitSeek,
  } = config

  const applyFailContextRef = useRef({
    itemId: current?.id,
    itemName: current?.name,
    src: activePlaybackSrc,
    viewType,
  })
  /* eslint-disable react-hooks/refs -- sync latest snapshots for event handlers */
  applyFailContextRef.current = {
    itemId: current?.id,
    itemName: current?.name,
    src: activePlaybackSrc,
    viewType,
  }

  const { applyRoomClock, clearTransportNudge } = useApplyRoomClock({
    isMediaReadyRef,
    playbackPausedRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    onApplyFailed: (syncState) => {
      console.warn("[player] applyRoomClock failed", {
        ...applyFailContextRef.current,
        syncState,
      })
    },
  })

  useEffect(() => {
    if (!current) return
    if (current.sourceKind !== "local_file" || !current.localOriginUserId)
      return
    const ownerConnected =
      roomState.participants[current.localOriginUserId]?.connected ?? false
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
  }, [current, playerRef, reportedItemErrorRef, roomState.participants])

  // Keep authority readable from media event handlers in the same commit.
  playbackRef.current = roomState.playback
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    isMediaReadyRef.current = false
    pendingSyncRef.current = null
    lastAppliedTimelineAnchorMsRef.current = null
    bufferingSinceRef.current = Date.now()
    participantStatusErrorRef.current = null
    proxyRenewAttemptedRef.current = null
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
    playerRef,
    isMediaReadyRef,
    playbackRef,
    pendingSyncRef,
    holdLocalSeek:
      awaitingSeekTargetMs !== null || seekPhase === "previewing",
    timelineAnchorMs,
    applyRoomClock,
  })

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    const syncState = pendingSyncFromPlayback(roomState.playback)
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
    playerRef,
    roomState.playback.paused,
    roomState.playback.playbackRate,
    roomState.playback.serverNowMs,
    roomState.playback.timelineAnchorMs,
    roomState.playback.videoLoop,
  ])

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    // Presence ticks: only send when paused/loading/error change, time drifts,
    // or a slow heartbeat keeps lastSeen fresh.
    const HEARTBEAT_MS = 2_000
    const TIME_DIRTY_MS = 750
    let lastSent = {
      paused: Boolean(player.paused),
      currentTimeMs: Math.max(
        0,
        Math.floor(Number(player.currentTime ?? 0) * 1000),
      ),
      loading: isBuffering,
      // Send null (not undefined) so JSON keeps the key and the server can clear.
      error:
        playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      at: 0,
    }

    const timer = window.setInterval(() => {
      const next = {
        paused: Boolean(player.paused),
        currentTimeMs: Math.max(
          0,
          Math.floor(Number(player.currentTime ?? 0) * 1000),
        ),
        loading: isBuffering,
        error:
          playbackErrorLabel ?? participantStatusErrorRef.current ?? null,
      }
      const now = Date.now()
      const dirty =
        next.paused !== lastSent.paused ||
        next.loading !== lastSent.loading ||
        next.error !== lastSent.error ||
        Math.abs(next.currentTimeMs - lastSent.currentTimeMs) >= TIME_DIRTY_MS ||
        now - lastSent.at >= HEARTBEAT_MS
      if (!dirty) {
        return
      }

      lastSent = { ...next, at: now }
      send("participant:update", next)
    }, 500)
    return () => window.clearInterval(timer)
  }, [
    isBuffering,
    participantStatusErrorRef,
    playbackErrorLabel,
    playerRef,
    roomState.currentIndex,
    send,
  ])

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
