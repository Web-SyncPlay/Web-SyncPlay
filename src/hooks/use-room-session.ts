"use client"

import {
  getPlayerEmbedUrl,
  getRoomPopupUrl,
  getRoomUrl,
} from "@/client/realtime/control-url"
import type { SessionKind } from "@/contracts/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useControlEmbedUrl } from "./use-control-embed-url"
import { useRoomSocket } from "./use-room-socket"

/**
 * Player embed URL for in-app open. Empty until identity is ready so we never
 * hand off `#uid=&secret=` (private-mode fallback would mint a new guest).
 */
export function pickPlayerEmbedUrl(input: {
  roomId: string
  userId: string
  userSecret: string
}): string {
  if (!input.userId || !input.userSecret) {
    return ""
  }
  return getPlayerEmbedUrl(input.roomId, input.userId, input.userSecret)
}

/**
 * Room-view popup URL with the same identity-hash handover as embeds.
 * Share/copy links stay on {@link getRoomUrl} (no secrets).
 */
export function pickRoomPopupUrl(input: {
  roomId: string
  userId: string
  userSecret: string
}): string {
  if (!input.userId || !input.userSecret) {
    return ""
  }
  return getRoomPopupUrl(input.roomId, input.userId, input.userSecret)
}

export function useRoomSession(
  roomId: string,
  options?: { sessionKind?: SessionKind; initialMediaUrl?: string },
) {
  const sessionKind = options?.sessionKind ?? "room"
  const {
    roomState,
    sessionCapabilities,
    send,
    userId,
    userSecret,
    status,
    joinError,
    submitJoinPassword,
  } = useRoomSocket(roomId, {
    sessionKind,
    initialMediaUrl: options?.initialMediaUrl,
  })
  const [copied, setCopied] = useState(false)

  const shareUrl = useMemo(() => getRoomUrl(roomId), [roomId])
  const roomUrl = useMemo(
    () => pickRoomPopupUrl({ roomId, userId, userSecret }),
    [roomId, userId, userSecret],
  )
  const playerEmbedUrl = useMemo(
    () => pickPlayerEmbedUrl({ roomId, userId, userSecret }),
    [roomId, userId, userSecret],
  )
  const participantRole = roomState?.participants[userId]?.role
  const controlEmbedUrl = useControlEmbedUrl({
    roomId,
    userId,
    userSecret,
    participantRole,
  })

  const handleCopyShareUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }, [shareUrl])

  useEffect(() => {
    if (!copied) {
      return
    }

    const timeout = window.setTimeout(() => {
      setCopied(false)
    }, 1600)
    return () => window.clearTimeout(timeout)
  }, [copied])

  return {
    roomState,
    sessionCapabilities,
    send,
    userId,
    userSecret,
    status,
    joinError,
    submitJoinPassword,
    copied,
    shareUrl,
    roomUrl,
    playerEmbedUrl,
    controlEmbedUrl,
    handleCopyShareUrl,
  }
}
