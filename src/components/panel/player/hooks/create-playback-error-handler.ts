import type { MediaErrorDetail } from "@vidstack/react"
import { toast } from "sonner"

import { localMediaErrorMessage } from "@/shared/local-media/local-media-errors"

import { formatMediaErrorDetail, mediaErrorCode } from "../player-src"
import type { SyncedMediaPlayerHandlerDeps } from "./synced-media-player-handler-types"

type PlaybackErrorDeps = Pick<
  SyncedMediaPlayerHandlerDeps,
  | "current"
  | "playerSrc"
  | "activePlaybackSrc"
  | "send"
  | "canControlPlayback"
  | "userId"
  | "bufferingSinceRef"
  | "participantStatusErrorRef"
  | "reportedItemErrorRef"
  | "proxyRenewAttemptedRef"
  | "localBlobFallbackAttemptedRef"
  | "setIsBuffering"
  | "setPlaybackError"
  | "setForceLocalRelaySrc"
  | "setPlayerRemountNonce"
>

/** MediaPlayer `onError` — blob fallback, proxy renew, toast + room report. */
export function createPlaybackErrorHandler(deps: PlaybackErrorDeps) {
  const {
    current,
    playerSrc,
    activePlaybackSrc,
    send,
    canControlPlayback,
    userId,
    bufferingSinceRef,
    participantStatusErrorRef,
    reportedItemErrorRef,
    proxyRenewAttemptedRef,
    localBlobFallbackAttemptedRef,
    setIsBuffering,
    setPlaybackError,
    setForceLocalRelaySrc,
    setPlayerRemountNonce,
  } = deps

  return {
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

      const erroredItemId = current?.id ?? null

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

      const remoteUrlUserMessage = (() => {
        if (current?.sourceKind !== "remote_url") return null
        if (current.ingestError?.trim()) {
          return current.ingestError.trim()
        }
        // MEDIA_ERR_SRC_NOT_SUPPORTED / failed resource — often a page URL
        // or non-stream host that slipped past resolve.
        if (errorCode === 4) {
          const playingSourcePage =
            Boolean(activePlaybackSrc) &&
            Boolean(current.sourceUrl) &&
            activePlaybackSrc === current.sourceUrl
          if (playingSourcePage) {
            return "This URL is a web page, not a playable media stream. Use a direct media link or a supported host."
          }
          return "Could not load this media. The stream may be missing, blocked, or in an unsupported format."
        }
        return null
      })()

      const userMessage =
        localFileUserMessage ?? remoteUrlUserMessage ?? message

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

      // Prefer the user-facing copy on the recovery overlay (not raw MediaError 4).
      setPlaybackError(
        userMessage === message
          ? detail
          : ({
              ...(detail as object),
              message: userMessage,
            } as MediaErrorDetail),
        erroredItemId,
      )

      if (
        current &&
        canControlPlayback &&
        current.ingestStatus !== "resolving" &&
        current.ingestStatus !== "error" &&
        reportedItemErrorRef.current !== current.id
      ) {
        reportedItemErrorRef.current = current.id
        toast.error(userMessage)
        send("playlist:item:error", {
          itemId: current.id,
          error: userMessage,
        })
      }
      console.error("[player] playback error", {
        detail,
        message,
        userMessage,
        sourceKind: current?.sourceKind,
        source: activePlaybackSrc,
        playerSrc,
      })
    },
  }
}
