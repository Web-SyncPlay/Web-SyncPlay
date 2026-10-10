import type {
  DefaultJoinRole,
  PublicRoomSecurityState,
  RoomSecurityState,
  RoomSnapshotPayload,
  RoomState,
} from "@/contracts/types"
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const JOIN_PASSWORD_KEY_LENGTH = 64
const JOIN_PASSWORD_SALT_BYTES = 16
const scryptAsync = promisify(scrypt)

export type JoinAdmissionResult =
  | { allowed: true }
  | { allowed: false; reason: "password_required" | "invalid_password" }

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asNonNegativeInt(value: unknown, fallback = 0): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0
    ? value
    : fallback
}

function asFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function normalizeDefaultJoinRole(
  value: unknown,
): DefaultJoinRole {
  return value === "guest" ? "guest" : "moderator"
}

export function createDefaultRoomSecurity(): RoomSecurityState {
  return {
    joinPasswordEnabled: false,
    joinPasswordUpdatedAt: null,
    admissionVersion: 0,
    defaultJoinRole: "guest",
  }
}

export function ensureRoomSecurity(state: RoomState): RoomSecurityState {
  const current = state.roomSecurity
  const normalized: RoomSecurityState = {
    joinPasswordEnabled: current?.joinPasswordEnabled === true,
    joinPasswordUpdatedAt: asFiniteNumberOrNull(current?.joinPasswordUpdatedAt),
    admissionVersion: asNonNegativeInt(current?.admissionVersion),
    defaultJoinRole: normalizeDefaultJoinRole(current?.defaultJoinRole),
    joinPasswordHash: asOptionalString(current?.joinPasswordHash),
    joinPasswordSalt: asOptionalString(current?.joinPasswordSalt),
  }

  if (
    normalized.joinPasswordEnabled &&
    (!normalized.joinPasswordHash || !normalized.joinPasswordSalt)
  ) {
    normalized.joinPasswordEnabled = false
    normalized.joinPasswordHash = undefined
    normalized.joinPasswordSalt = undefined
  }

  state.roomSecurity = normalized
  return normalized
}

/** Client-safe security view: never includes hash/salt secrets. */
export function publicRoomSecurity(
  security: RoomSecurityState,
): PublicRoomSecurityState {
  return {
    joinPasswordEnabled: security.joinPasswordEnabled,
    joinPasswordUpdatedAt: security.joinPasswordUpdatedAt,
    admissionVersion: security.admissionVersion,
    defaultJoinRole: security.defaultJoinRole,
  }
}

export function sanitizeRoomStateForClient(
  state: RoomState,
): RoomSnapshotPayload {
  return {
    ...state,
    roomSecurity: publicRoomSecurity(ensureRoomSecurity(state)),
  }
}

export function setDefaultJoinRole(
  state: RoomState,
  role: DefaultJoinRole,
): boolean {
  const security = ensureRoomSecurity(state)
  if (security.defaultJoinRole === role) {
    return false
  }
  security.defaultJoinRole = role
  return true
}

export async function setJoinPassword(
  state: RoomState,
  password: string,
): Promise<void> {
  const security = ensureRoomSecurity(state)
  const salt = randomBytes(JOIN_PASSWORD_SALT_BYTES).toString("hex")
  security.joinPasswordEnabled = true
  security.joinPasswordSalt = salt
  security.joinPasswordHash = await hashJoinPassword(password.trim(), salt)
  security.joinPasswordUpdatedAt = Date.now()
  security.admissionVersion += 1
}

export function clearJoinPassword(state: RoomState): boolean {
  const security = ensureRoomSecurity(state)
  const changed =
    security.joinPasswordEnabled ||
    Boolean(security.joinPasswordHash) ||
    Boolean(security.joinPasswordSalt)
  security.joinPasswordEnabled = false
  security.joinPasswordHash = undefined
  security.joinPasswordSalt = undefined
  security.joinPasswordUpdatedAt = Date.now()
  security.admissionVersion += changed ? 1 : 0
  return changed
}

export async function evaluateJoinAdmission(
  state: RoomState | null,
  suppliedPassword?: string,
): Promise<JoinAdmissionResult> {
  if (!state) {
    return { allowed: true }
  }

  const security = ensureRoomSecurity(state)
  if (!security.joinPasswordEnabled) {
    return { allowed: true }
  }

  if (!suppliedPassword?.trim()) {
    return { allowed: false, reason: "password_required" }
  }

  if (!(await verifyJoinPassword(state, suppliedPassword))) {
    return { allowed: false, reason: "invalid_password" }
  }

  return { allowed: true }
}

export async function verifyJoinPassword(
  state: RoomState,
  suppliedPassword: string,
): Promise<boolean> {
  const security = ensureRoomSecurity(state)
  if (
    !security.joinPasswordEnabled ||
    !security.joinPasswordHash ||
    !security.joinPasswordSalt
  ) {
    return true
  }

  const expected = Buffer.from(security.joinPasswordHash, "hex")
  const actual = Buffer.from(
    await hashJoinPassword(suppliedPassword.trim(), security.joinPasswordSalt),
    "hex",
  )

  if (expected.length !== actual.length) {
    return false
  }

  return timingSafeEqual(expected, actual)
}

async function hashJoinPassword(
  password: string,
  salt: string,
): Promise<string> {
  const derived = (await scryptAsync(
    password,
    salt,
    JOIN_PASSWORD_KEY_LENGTH,
  )) as Buffer
  return derived.toString("hex")
}
