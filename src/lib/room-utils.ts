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
