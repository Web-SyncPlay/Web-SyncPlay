import { mintRoomControlToken } from "./control-token-client"
import { buildIdentityHash } from "./session-identity"

function roomPath(roomId: string, embed?: "control" | "player"): string {
  return embed ? `/room/${roomId}/${embed}` : `/room/${roomId}`
}

function withIdentityHash(
  path: string,
  userId: string,
  userSecret: string,
  controlToken?: string,
): string {
  const hash = buildIdentityHash(userId, userSecret, controlToken)
  if (typeof window === "undefined") {
    return `${path}#${hash}`
  }
  const url = new URL(path, window.location.origin)
  url.hash = hash
  return url.toString()
}

export function getRoomUrl(roomId: string): string {
  const path = roomPath(roomId)
  if (typeof window === "undefined") {
    return path
  }
  return `${window.location.origin}${path}`
}

export function getControlEmbedUrl(
  roomId: string,
  userId: string,
  userSecret: string,
  controlToken?: string,
): string {
  return withIdentityHash(
    roomPath(roomId, "control"),
    userId,
    userSecret,
    controlToken,
  )
}

export function getPlayerEmbedUrl(
  roomId: string,
  userId: string,
  userSecret: string,
): string {
  return withIdentityHash(roomPath(roomId, "player"), userId, userSecret)
}

/** Mint a control token via HTTP. Returns null on failure (no silent tokenless auth). */
export async function requestControlToken(input: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<{ token: string; expiresAt?: number } | null> {
  return mintRoomControlToken(input)
}

/**
 * Builds a control embed URL with a minted `ct=` token.
 * Returns null when minting fails — callers must not treat a tokenless URL
 * as authorized for mutations.
 */
export async function mintControlEmbedUrl(input: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<string | null> {
  const minted = await mintRoomControlToken(input)
  if (!minted) {
    return null
  }
  return getControlEmbedUrl(
    input.roomId,
    input.userId,
    input.userSecret,
    minted.token,
  )
}
