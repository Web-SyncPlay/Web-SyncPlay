"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react"
import { toast } from "sonner"

import {
  pendingSyncFromPlayback,
  type PendingSyncState,
} from "@/client/player/pending-sync"
import { resolveProviderSyncTuning } from "@/client/player/provider-sync-tuning"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import type { ClientRoomState, PlaylistItem } from "@/contracts/types"
import { useLatestRef } from "@/hooks/use-latest-ref"
import {
  queryPlayerMediaElement,
  readMediaSeekableEndSec,
} from "@/shared/dom/player-utils"
import { localMediaErrorMessage } from "@/shared/local-media/local-media-errors"
import { isNativeProviderUrl, resolveLiveEdgeSec } from "@/shared/player-utils"

import { SEEK_ACK_MATCH_THRESHOLD_MS } from "../playback-control/use-playback-timeline-controller"
import { playerSrcContentKey, type PlayerSrcInput } from "../player-src"
import { readSyncPlayheadSec } from "./to-syncable-player"
import { useApplyRoomClock } from "./use-apply-room-clock"
import { usePlaybackDriftCorrection } from "./use-playback-drift-correction"
import { usePlaybackSyncEngine } from "./use-playback-sync-engine"
import { usePlayerPresenceHeartbeat } from "./use-player-presence-heartbeat"
import { usePlayerVisibilityResume } from "./use-player-visibility-resume"

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
  catchUpRateRef: RefObject<number | null>
  onCatchUpRateChange?: (next: number | null) => void
  playbackRef: RefObject<ClientRoomState["playback"]>
  playbackPausedRef: RefObject<boolean>
  reportedItemErrorRef: RefObject<string | null>
  proxyRenewAttemptedRef: RefObject<string | null>
  current: PlaylistItem | undefined
  activePlaybackSrc: string
  viewType: "audio" | "video"
  playerSrc: PlayerSrcInput
  /** Playback slice — not the full room (presence stays off this hook). */
  playback: ClientRoomState["playback"]
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
  setIsBuffering: (next: boolean) => void
  setPlayerRemountNonce?: Dispatch<SetStateAction<number>>
}) {
  const {
    playerRef,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    catchUpRateRef,
    onCatchUpRateChange,
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
    setIsBuffering,
    setPlayerRemountNonce,
  } = config

  const applyFailContextRef = useLatestRef({
    itemId: current?.id,
    itemName: current?.name,
    src: activePlaybackSrc,
    viewType,
  })

  const isNativeSource = useCallback(
    () => isNativeProviderUrl(applyFailContextRef.current.src),
    [applyFailContextRef],
  )
  const catalogDurationRef = useLatestRef(
    current?.isLive === true
      ? Number.POSITIVE_INFINITY
      : Number(current?.durationSeconds),
  )

  // Content key — not object identity — so playlist/room churn with the same
  // URL+MIME does not clear isMediaReady without a real media reload.
  const mediaSourceKey = playerSrcContentKey(playerSrc) || activePlaybackSrc

  const syncEngine = usePlaybackSyncEngine({
    playerRef,
    isMediaReadyRef,
    playbackPausedRef,
    pendingSyncRef,
    lastAppliedTimelineAnchorMsRef,
    catchUpRateRef,
    onCatchUpRateChange,
    playbackRef,
    // Native iframe providers (YouTube/Vimeo) get longer pause/seek retries;
    // HLS / direct media resolve to undefined and keep engine defaults.
    getSyncTuning: () =>
      resolveProviderSyncTuning(applyFailContextRef.current.src),
    getDurationHintSec: () => catalogDurationRef.current,
    onApplyFailed: (syncState) => {
      console.warn("[player] applyRoomClock failed", {
        ...applyFailContextRef.current,
        syncState,
      })
    },
  })

  const { applyRoomClock, clearTransportNudge } = useApplyRoomClock({
    engine: syncEngine,
    isNativeSource,
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
    mediaSourceKey,
    participantStatusErrorRef,
    pendingSyncRef,
    proxyRenewAttemptedRef,
    syncEngine,
  ])

  const getCurrentTimeMs = useCallback(() => {
    const player = playerRef.current
    if (!player) {
      return 0
    }

    // Same read as the sync engine (media element for HLS, provider time for
    // YouTube/Vimeo) so presence and drift correction cannot disagree.
    const playheadSec = readSyncPlayheadSec(player, {
      native: isNativeSource(),
    })
    return Number.isFinite(playheadSec)
      ? Math.max(0, Math.floor(playheadSec * 1000))
      : 0
  }, [isNativeSource, playerRef])

  usePlaybackDriftCorrection({
    engine: syncEngine,
    holdLocalSeek: awaitingSeekTargetMs !== null || seekPhase === "previewing",
    timelineAnchorMs,
  })

  /** Last `playback.paused` seen by the authority effect (edge detection). */
  const prevRoomPausedRef = useRef<boolean | null>(null)

  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      return
    }

    // Authority play → pause edge: HLS / local HTTP relay often ignores the
    // first pause() and sits under the 0.8s drift threshold, so force-snap
    // (threshold 0) and re-arm the pause nudge burst from a clean slate.
    const pausedEdge = prevRoomPausedRef.current === false && playback.paused

    const syncState = pendingSyncFromPlayback(playback)
    const shouldHoldForLocalSeek =
      awaitingSeekTargetMs !== null &&
      Math.abs(syncState.timelineAnchorMs - awaitingSeekTargetMs) >=
        SEEK_ACK_MATCH_THRESHOLD_MS
    if (shouldHoldForLocalSeek) {
      return
    }
    prevRoomPausedRef.current = playback.paused

    pendingSyncRef.current = syncState
    if (!isMediaReadyRef.current) {
      return
    }

    // Authority seeks must always apply — the default drift threshold can
    // skip small jumps and leave peers on the previous timeline. The engine
    // additionally force-snaps (threshold 0) on the first ready apply so late
    // joiners converge even when `anchorChanged` is still false.
    const anchorChanged =
      lastAppliedTimelineAnchorMsRef.current !== null &&
      lastAppliedTimelineAnchorMsRef.current !== syncState.timelineAnchorMs
    if (pausedEdge) {
      clearTransportNudge()
    }
    applyRoomClock(
      player,
      syncState,
      anchorChanged || pausedEdge ? 0 : undefined,
    )
    // Sync fields only — seekPreview/mediaId/playlistLoop must not re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- field-level playback deps
  }, [
    clearTransportNudge,
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

  const { flushPresence } = usePlayerPresenceHeartbeat({
    playerRef,
    participantStatusErrorRef,
    isMediaReadyRef,
    isBuffering,
    playbackErrorLabel,
    currentIndex,
    roomPaused: playback.paused,
    send,
    getPlayheadSec: () => {
      const player = playerRef.current
      return player
        ? readSyncPlayheadSec(player, { native: isNativeSource() })
        : 0
    },
  })

  usePlayerVisibilityResume({
    playerRef,
    isMediaReadyRef,
    bufferingSinceRef,
    pendingSyncRef,
    playbackRef,
    applyRoomClock,
    flushPresence,
    setIsBuffering,
    setPlayerRemountNonce,
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
  }, [canControlPlayback, commitSeek, enforceServerPlaybackState, playerRef])

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
    clearTransportNudge,
    getCurrentTimeMs,
    enforceServerPlaybackState,
    commitLiveEdgeSeek,
  }
}
