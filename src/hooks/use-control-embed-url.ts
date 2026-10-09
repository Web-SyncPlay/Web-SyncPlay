"use client"

import {
  createControlTokenRefreshScheduler,
  mintRoomControlTokenWithRetry,
} from "@/lib/control-token-client"
import { getControlEmbedUrl } from "@/lib/control-url"
import { canMutateByRole } from "@/lib/permissions-utils"
import type { RoomRole } from "@/zod/types"
import { useEffect, useMemo, useState } from "react"

/**
 * Picks the control embed URL for the current role.
 * Mutators never get a tokenless `/control` fallback — empty until mint succeeds.
 */
export function pickControlEmbedUrl(input: {
  canMutate: boolean
  identityControlEmbedUrl: string | null
  mintedUrl: string | null
}): string {
  if (!input.canMutate) {
    return input.identityControlEmbedUrl ?? ""
  }
  return input.mintedUrl ?? ""
}

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

  const canMutate = canMutateByRole(participantRole)

  useEffect(() => {
    // Identity is empty until session storage/crypto finishes; minting then
    // hits POST /api/control/token with "" fields and returns 400.
    if (!userId || !userSecret) {
      return
    }
    if (!canMutate) {
      return
    }

    let cancelled = false
    const scheduler = createControlTokenRefreshScheduler({
      onMinted: (minted) => {
        if (cancelled) {
          return
        }
        setMintedControlEmbedUrl({
          scopeKey: mintScopeKey,
          url: getControlEmbedUrl(
            roomId,
            userId,
            userSecret,
            minted.token,
          ),
        })
      },
    })

    void (async () => {
      const minted = await mintRoomControlTokenWithRetry({
        roomId,
        userId,
        userSecret,
      })
      if (cancelled || !minted) {
        return
      }
      setMintedControlEmbedUrl({
        scopeKey: mintScopeKey,
        url: getControlEmbedUrl(roomId, userId, userSecret, minted.token),
      })
      scheduler.arm(
        { roomId, userId, userSecret },
        minted.expiresAt,
      )
    })()

    return () => {
      cancelled = true
      scheduler.disarm()
    }
  }, [mintScopeKey, canMutate, roomId, userId, userSecret])

  const scopedMintedUrl =
    mintedControlEmbedUrl?.scopeKey === mintScopeKey
      ? mintedControlEmbedUrl.url
      : null

  return pickControlEmbedUrl({
    canMutate,
    identityControlEmbedUrl,
    mintedUrl: scopedMintedUrl,
  })
}
