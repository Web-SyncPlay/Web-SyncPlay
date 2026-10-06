import type { ParticipantState } from "@/zod/types"
import {
  adjectives,
  animals,
  colors,
  names,
  starWars,
  uniqueNamesGenerator,
} from "unique-names-generator"
import { getRandomItem } from "./utils"

export const nameLists = [adjectives, animals, colors, starWars, names] as const

function pickNameDictionaries(words: number) {
  const dictionaries = []
  for (let i = 0; i < words; i++) {
    dictionaries.push(getRandomItem(nameLists))
  }
  return dictionaries
}

/** URL-safe room id, e.g. `crimson-falcon`. */
export function randomRoomId(words = 2): string {
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
