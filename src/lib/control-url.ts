import { buildIdentityHash } from "./session-identity"

export function getRoomUrl(roomId: string): string {
  if (typeof window === "undefined") {
    return `/room/${roomId}`
  }
  return `${window.location.origin}/room/${roomId}`
}

function attachIdentityHash(
  url: URL,
  userId: string,
  userSecret: string,
  controlToken?: string,
): string {
  url.hash = buildIdentityHash(userId, userSecret, controlToken)
  return url.toString()
}

export function getControlEmbedUrl(
  roomId: string,
  userId: string,
  userSecret: string,
  controlToken?: string,
): string {
  if (typeof window === "undefined") {
    return `/room/${roomId}/control#${buildIdentityHash(userId, userSecret, controlToken)}`
  }
  const url = new URL(`/room/${roomId}/control`, window.location.origin)
  return attachIdentityHash(url, userId, userSecret, controlToken)
}

export function getPlayerEmbedUrl(
  roomId: string,
  userId: string,
  userSecret: string,
): string {
  if (typeof window === "undefined") {
    return `/room/${roomId}/player#${buildIdentityHash(userId, userSecret)}`
  }
  const url = new URL(`/room/${roomId}/player`, window.location.origin)
  return attachIdentityHash(url, userId, userSecret)
}

export async function mintControlEmbedUrl(input: {
  roomId: string
  userId: string
  userSecret: string
}): Promise<string> {
  if (!input.roomId || !input.userId || !input.userSecret) {
    return getControlEmbedUrl(input.roomId, input.userId, input.userSecret)
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
      return getControlEmbedUrl(input.roomId, input.userId, input.userSecret)
    }
    const payload = (await response.json()) as { token?: string }
    return getControlEmbedUrl(
      input.roomId,
      input.userId,
      input.userSecret,
      payload.token,
    )
  } catch {
    return getControlEmbedUrl(input.roomId, input.userId, input.userSecret)
  }
}
