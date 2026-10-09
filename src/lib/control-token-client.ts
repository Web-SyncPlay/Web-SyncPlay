import { canMutateByRole } from "@/lib/permissions-utils"
import {
  loadPersistedControlToken,
  persistControlToken,
} from "@/lib/session-identity"
import type { RoomRole, SessionKind } from "@/zod/types"

/** Hash `ct=` first, then session-scoped storage for control embed refreshes. */
export function resolveBootstrapControlToken(input: {
  sessionKind: SessionKind
  roomId?: string
  hashControlToken?: string
}): string | undefined {
  const { sessionKind, roomId, hashControlToken } = input
  if (hashControlToken) {
    if (roomId) {
      persistControlToken(roomId, hashControlToken)
    }
    return hashControlToken
  }
  if (sessionKind === "control" && roomId) {
    return loadPersistedControlToken(roomId)
  }
  return undefined
}

/** Mint a control token via HTTP and persist for the room session. */
export async function mintRoomControlToken(input: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<{ token: string; expiresAt?: number } | null> {
  if (!input.roomId || !input.userId || !input.userSecret) {
    return null
  }
  try {
    const response = await fetch("/api/control/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: input.roomId,
        userId: input.userId,
        userSecret: input.userSecret,
      }),
    })
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as {
      token?: string
      expiresAt?: number
    }
    if (typeof payload.token !== "string" || payload.token.length === 0) {
      return null
    }
    persistControlToken(input.roomId, payload.token)
    return {
      token: payload.token,
      ...(typeof payload.expiresAt === "number"
        ? { expiresAt: payload.expiresAt }
        : {}),
    }
  } catch {
    return null
  }
}

export function shouldRemintControlToken(input: {
  sessionKind: SessionKind
  controlAuthorized: boolean
  role: RoomRole | undefined
  remintAlreadyAttempted: boolean
}): boolean {
  return (
    input.sessionKind === "control" &&
    !input.controlAuthorized &&
    canMutateByRole(input.role) &&
    !input.remintAlreadyAttempted
  )
}

/** Mint at most once per lifecycle until reset (e.g. effect remount). */
export function createControlTokenReminter(): {
  reset: () => void
  tryRemint: (input: {
    roomId: string
    userId: string
    userSecret: string
    sessionKind: SessionKind
    controlAuthorized: boolean
    role: RoomRole | undefined
  }) => Promise<string | null>
} {
  let remintAlreadyAttempted = false

  return {
    reset() {
      remintAlreadyAttempted = false
    },
    async tryRemint(input) {
      if (
        !shouldRemintControlToken({
          sessionKind: input.sessionKind,
          controlAuthorized: input.controlAuthorized,
          role: input.role,
          remintAlreadyAttempted,
        })
      ) {
        return null
      }
      remintAlreadyAttempted = true
      const minted = await mintRoomControlToken({
        roomId: input.roomId,
        userId: input.userId,
        userSecret: input.userSecret,
      })
      if (!minted) {
        remintAlreadyAttempted = false
        return null
      }
      return minted.token
    },
  }
}
