"use client"

import {
  getPlayerEmbedUrl,
  getRoomUrl,
  mintControlEmbedUrl,
} from "@/lib/control-url"
import type { SessionKind } from "@/zod/types"
import { useCallback, useEffect, useMemo, useState } from "react"
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
  const [controlEmbedUrl, setControlEmbedUrl] = useState(() =>
    typeof window === "undefined"
      ? `/room/${roomId}/control`
      : `${window.location.origin}/room/${roomId}/control`,
  )

  const shareUrl = useMemo(() => getRoomUrl(roomId), [roomId])
  const playerEmbedUrl = useMemo(
    () => getPlayerEmbedUrl(roomId, userId, userSecret),
    [roomId, userId, userSecret],
  )

  const participantRole = roomState?.participants[userId]?.role

  useEffect(() => {
    let cancelled = false
    void mintControlEmbedUrl({ roomId, userId, userSecret }).then((url) => {
      if (!cancelled) setControlEmbedUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [roomId, userId, userSecret, participantRole])

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
