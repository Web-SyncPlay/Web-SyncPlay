import { canMutateByRole } from "@/lib/permissions-utils"
import {
  loadPersistedControlToken,
  loadPersistedControlTokenRecord,
  persistControlToken,
} from "@/lib/session-identity"
import type { RoomRole, SessionKind } from "@/zod/types"

/** Remint this long before expiry (capped by remaining lifetime). */
export const CONTROL_TOKEN_REMINT_SKEW_MS = 60_000

const DEFAULT_MINT_RETRY_ATTEMPTS = 3
const DEFAULT_MINT_RETRY_BASE_DELAY_MS = 400

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

/** Delay until a proactive remint should fire (0 = remint now). */
export function msUntilControlTokenRemint(
  expiresAt: number,
  now: number = Date.now(),
): number {
  const remaining = expiresAt - now
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 0
  }
  const skew = Math.min(
    CONTROL_TOKEN_REMINT_SKEW_MS,
    Math.max(0, Math.floor(remaining * 0.1)),
  )
  return Math.max(0, remaining - skew)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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
    const expiresAt =
      typeof payload.expiresAt === "number" && Number.isFinite(payload.expiresAt)
        ? payload.expiresAt
        : undefined
    persistControlToken(input.roomId, payload.token, expiresAt)
    return {
      token: payload.token,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    }
  } catch {
    return null
  }
}

/** Mint with limited backoff retries (for embed URL / proactive refresh). */
export async function mintRoomControlTokenWithRetry(
  input: {
    roomId: string
    userId: string
    userSecret: string
  },
  options?: {
    maxAttempts?: number
    baseDelayMs?: number
    sleep?: (ms: number) => Promise<void>
  },
): Promise<{ token: string; expiresAt?: number } | null> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MINT_RETRY_ATTEMPTS
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_MINT_RETRY_BASE_DELAY_MS
  const wait = options?.sleep ?? sleep

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const minted = await mintRoomControlToken(input)
    if (minted) {
      return minted
    }
    if (attempt + 1 < maxAttempts) {
      await wait(baseDelayMs * 2 ** attempt)
    }
  }
  return null
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

export type ControlTokenRefreshCredentials = {
  roomId: string
  userId: string
  userSecret: string
}

/**
 * Schedules proactive remint before `expiresAt`. On success persists the new
 * token and invokes `onMinted` so active sessions can refresh join/`ct`.
 */
export function createControlTokenRefreshScheduler(options?: {
  onMinted?: (result: { token: string; expiresAt?: number }) => void
  mint?: typeof mintRoomControlToken
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (id: number) => void
}): {
  arm: (
    credentials: ControlTokenRefreshCredentials,
    expiresAt?: number,
  ) => void
  disarm: () => void
  /** Re-arm from sessionStorage when an expiry is known. */
  armFromStorage: (credentials: ControlTokenRefreshCredentials) => void
} {
  const mint = options?.mint ?? mintRoomControlToken
  const now = options?.now ?? Date.now
  const setTimer =
    options?.setTimer ??
    ((fn, ms) => window.setTimeout(fn, ms) as unknown as number)
  const clearTimer =
    options?.clearTimer ?? ((id) => window.clearTimeout(id))

  let timerId: number | undefined
  let armedCredentials: ControlTokenRefreshCredentials | null = null
  let inFlight = false

  const disarm = () => {
    if (timerId !== undefined) {
      clearTimer(timerId)
      timerId = undefined
    }
  }

  const runRemint = async () => {
    if (!armedCredentials || inFlight) {
      return
    }
    inFlight = true
    try {
      const minted = await mint(armedCredentials)
      if (!minted) {
        // Retry once shortly after failure.
        timerId = setTimer(() => {
          void runRemint()
        }, DEFAULT_MINT_RETRY_BASE_DELAY_MS)
        return
      }
      options?.onMinted?.(minted)
      if (typeof minted.expiresAt === "number") {
        arm(armedCredentials, minted.expiresAt)
      }
    } finally {
      inFlight = false
    }
  }

  const arm = (
    credentials: ControlTokenRefreshCredentials,
    expiresAt?: number,
  ) => {
    disarm()
    armedCredentials = credentials
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) {
      return
    }
    const delay = msUntilControlTokenRemint(expiresAt, now())
    timerId = setTimer(() => {
      void runRemint()
    }, delay)
  }

  const armFromStorage = (credentials: ControlTokenRefreshCredentials) => {
    const record = loadPersistedControlTokenRecord(credentials.roomId)
    arm(credentials, record?.expiresAt)
  }

  return { arm, disarm, armFromStorage }
}
