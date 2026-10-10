"use client"

import { resolveBootstrapControlToken } from "@/client/realtime/control-token-client"
import {
  consumeSessionIdentityFromHash,
  getOrCreateSessionIdentity,
  getPersistedUsername,
  persistUsername,
  stripIdentityHashFromUrl,
} from "@/client/realtime/session-identity"
import { getRandomName } from "@/shared/room-utils"
import type { SessionKind } from "@/contracts/types"
import { useEffect, useRef, useState, type MutableRefObject } from "react"

export type SessionIdentity = {
  userId: string
  userSecret: string
}

/**
 * Loads persisted / hash-bootstrap identity, strips identity URL fragments,
 * and seeds a durable username for room:join.
 * Control sessions also restore a session-scoped minted control token.
 */
export function useSessionIdentityBootstrap(options?: {
  roomId?: string
  sessionKind?: SessionKind
}): {
  identity: SessionIdentity | null
  controlTokenRef: MutableRefObject<string | undefined>
  usernameRef: MutableRefObject<string>
} {
  const roomId = options?.roomId
  const sessionKind = options?.sessionKind ?? "room"
  const [identity, setIdentity] = useState<SessionIdentity | null>(null)
  const controlTokenRef = useRef<string | undefined>(undefined)
  const usernameRef = useRef<string>("guest")

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const fromHash = await consumeSessionIdentityFromHash()
      const bootstrapToken = resolveBootstrapControlToken({
        sessionKind,
        roomId,
        hashControlToken: fromHash.controlToken,
      })
      if (bootstrapToken) {
        controlTokenRef.current = bootstrapToken
      }
      const session = await getOrCreateSessionIdentity()
      if (cancelled) {
        return
      }
      setIdentity({
        userId: fromHash.userId ?? session.userId,
        userSecret: fromHash.userSecret ?? session.userSecret,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [roomId, sessionKind])

  useEffect(() => {
    // Some clients briefly re-apply the initial hash during hydration/history sync.
    // Re-strip identity bootstrap fragments after mount and on hash changes.
    const strip = () => {
      stripIdentityHashFromUrl()
    }
    strip()
    const stripTimer = window.setTimeout(strip, 0)
    const stripRaf = window.requestAnimationFrame(strip)
    window.addEventListener("hashchange", strip)
    return () => {
      window.clearTimeout(stripTimer)
      window.cancelAnimationFrame(stripRaf)
      window.removeEventListener("hashchange", strip)
    }
  }, [])

  useEffect(() => {
    const persistedUsername = getPersistedUsername()
    if (persistedUsername) {
      usernameRef.current = persistedUsername
      return
    }
    try {
      usernameRef.current = getRandomName()
      persistUsername(usernameRef.current)
    } catch {
      usernameRef.current = "guest"
      persistUsername(usernameRef.current)
    }
  }, [])

  return { identity, controlTokenRef, usernameRef }
}
