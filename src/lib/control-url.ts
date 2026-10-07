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

export async function mintControlEmbedUrl(input: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<string> {
  const fallback = () =>
    getControlEmbedUrl(input.roomId, input.userId, input.userSecret)

  if (!input.roomId || !input.userId || !input.userSecret) {
    return fallback()
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
      return fallback()
    }
    const payload = (await response.json()) as { token?: string }
    return getControlEmbedUrl(
      input.roomId,
      input.userId,
      input.userSecret,
      payload.token,
    )
  } catch {
    return fallback()
  }
}
