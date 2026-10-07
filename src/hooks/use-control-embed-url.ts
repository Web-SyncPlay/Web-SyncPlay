"use client"

import { getControlEmbedUrl, mintControlEmbedUrl } from "@/lib/control-url"
import { canMutateByRole } from "@/lib/permissions-utils"
import type { RoomRole } from "@/zod/types"
import { useEffect, useState } from "react"

/**
 * Builds the control embed URL for the current identity.
 * Owners/moderators mint a short-lived control token; others get a secret hash fallback.
 */
export function useControlEmbedUrl(input: {
  roomId: string
  userId: string
  userSecret: string
  participantRole: RoomRole | undefined
}): string {
  const { roomId, userId, userSecret, participantRole } = input
  const [controlEmbedUrl, setControlEmbedUrl] = useState(() =>
    typeof window === "undefined"
      ? `/room/${roomId}/control`
      : `${window.location.origin}/room/${roomId}/control`,
  )

  useEffect(() => {
    // Identity is empty until session storage/crypto finishes; minting then
    // hits POST /api/control/token with "" fields and returns 400.
    if (!userId || !userSecret) {
      return
    }
    // Token mint is only allowed for owner/moderator.
    if (!canMutateByRole(participantRole)) {
      setControlEmbedUrl(getControlEmbedUrl(roomId, userId, userSecret))
      return
    }

    let cancelled = false
    void mintControlEmbedUrl({ roomId, userId, userSecret }).then((url) => {
      if (!cancelled) setControlEmbedUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [roomId, userId, userSecret, participantRole])

  return controlEmbedUrl
}
