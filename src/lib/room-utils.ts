import type { ParticipantState } from "@/zod/types"
import {
  adjectives,
  animals,
  colors,
  names,
  starWars,
  uniqueNamesGenerator,
} from "unique-names-generator"

export const nameLists = [adjectives, animals, colors, starWars, names] as const

/** Pick `count` distinct dictionaries (without replacement). */
function pickNameDictionaries(count: number) {
  if (count < 1 || count > nameLists.length) {
    throw new Error(
      `Requested ${count} name dictionaries; need between 1 and ${nameLists.length}`,
    )
  }

  const pool = [...nameLists]
  const dictionaries = []
  for (let i = 0; i < count; i++) {
    const index = Math.floor(Math.random() * pool.length)
    dictionaries.push(pool.splice(index, 1)[0]!)
  }
  return dictionaries
}

function decodeRoomSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Accepts a bare room id, `/room/...` path, or full room URL.
 * Returns null when the input is empty/unusable.
 */
export function parseRoomId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const pathMatch = trimmed.match(/\/room\/([^/?#]+)/i)
  if (pathMatch?.[1]) {
    return decodeRoomSegment(pathMatch[1])
  }

  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed)
      const fromPath = url.pathname.match(/\/room\/([^/]+)/i)
      if (fromPath?.[1]) {
        return decodeRoomSegment(fromPath[1])
      }
    }
  } catch {
    // not a valid URL — fall through to bare id
  }

  const bare = trimmed.replace(/^\/+|\/+$/g, "")
  return bare || null
}

/** Path segments after stripping empty ends (keeps encoded roomId as one segment). */
function roomRouteSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean)
}

/** True for player/control/site-embed routes. */
export function isRoomEmbedPath(pathname: string): boolean {
  const segments = roomRouteSegments(pathname)
  if (segments.length !== 3 || segments[0] !== "room") return false
  const kind = segments[2]
  return kind === "player" || kind === "control" || kind === "embed"
}

/**
 * True for chrome-less player surfaces (OBS `/player` and host-site `/embed`).
 * Site footer / navbar hide here.
 */
export function isPlayerEmbedPath(pathname: string): boolean {
  const segments = roomRouteSegments(pathname)
  if (segments.length !== 3 || segments[0] !== "room") return false
  const kind = segments[2]
  return kind === "player" || kind === "embed"
}

/** URL-safe room id, e.g. `crimson-falcon-midnight-luke`. */
export function randomRoomId(words = 4): string {
  return uniqueNamesGenerator({
    dictionaries: pickNameDictionaries(words),
    length: words,
    style: "lowerCase",
    separator: "-",
  })
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function getRandomName(words = 2): string {
  return uniqueNamesGenerator({
    dictionaries: pickNameDictionaries(words),
    length: words,
    style: "capital",
  }).replaceAll("_", " ")
}

export function normalizeRole(
  role: ParticipantState["role"],
): ParticipantState["role"] {
  if (role === "owner" || role === "moderator" || role === "guest") {
    return role
  }
  return "guest"
}
