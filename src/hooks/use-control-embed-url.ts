"use client"

import { getControlEmbedUrl, mintControlEmbedUrl } from "@/lib/control-url"
import { canMutateByRole } from "@/lib/permissions-utils"
import type { RoomRole } from "@/zod/types"
import { useEffect, useMemo, useState } from "react"

/**
 * Builds the control embed URL for the current identity.
 * Owners/moderators mint a short-lived control token required for mutations.
 * Guests/non-moderators still get an identity-hash URL to open a view-only
 * control surface; without a minted token they cannot mutate.
 */
export function useControlEmbedUrl(input: {
  roomId: string
  userId: string
  userSecret: string
  participantRole: RoomRole | undefined
}): string {
  const { roomId, userId, userSecret, participantRole } = input
  const mintScopeKey = `${roomId}\0${userId}\0${userSecret}\0${participantRole ?? ""}`
  const [mintedControlEmbedUrl, setMintedControlEmbedUrl] = useState<{
    scopeKey: string
    url: string
  } | null>(null)

  const identityControlEmbedUrl = useMemo(() => {
    if (!userId || !userSecret) {
      return null
    }
    return getControlEmbedUrl(roomId, userId, userSecret)
  }, [roomId, userId, userSecret])

  const fallbackControlEmbedUrl =
    typeof window === "undefined"
      ? `/room/${roomId}/control`
      : `${window.location.origin}/room/${roomId}/control`

  useEffect(() => {
    // Identity is empty until session storage/crypto finishes; minting then
    // hits POST /api/control/token with "" fields and returns 400.
    if (!userId || !userSecret) {
      return
    }
    if (!canMutateByRole(participantRole)) {
      return
    }

    let cancelled = false
    void mintControlEmbedUrl({ roomId, userId, userSecret }).then((url) => {
      // Mint failure returns null — do not publish a tokenless mutator URL.
      if (!cancelled && url) {
        setMintedControlEmbedUrl({ scopeKey: mintScopeKey, url })
      }
    })
    return () => {
      cancelled = true
    }
  }, [mintScopeKey, participantRole, roomId, userId, userSecret])

  if (identityControlEmbedUrl && !canMutateByRole(participantRole)) {
    return identityControlEmbedUrl
  }
  const scopedMintedUrl =
    mintedControlEmbedUrl?.scopeKey === mintScopeKey
      ? mintedControlEmbedUrl.url
      : null
  return scopedMintedUrl ?? fallbackControlEmbedUrl
}
