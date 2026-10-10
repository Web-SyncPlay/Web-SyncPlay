"use client"

import {
  getPlayerEmbedUrl,
  getRoomUrl,
} from "@/client/realtime/control-url"
import type { SessionKind } from "@/contracts/types"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useControlEmbedUrl } from "./use-control-embed-url"
import { useRoomSocket } from "./use-room-socket"

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
  const playerEmbedUrl = useMemo(
    () => getPlayerEmbedUrl(roomId, userId, userSecret),
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
    playerEmbedUrl,
    controlEmbedUrl,
    handleCopyShareUrl,
  }
}
