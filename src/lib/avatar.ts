import * as adventurer from "@dicebear/adventurer"
import * as adventurerNeutral from "@dicebear/adventurer-neutral"
import * as avataaars from "@dicebear/avataaars"
import * as bottts from "@dicebear/bottts"
import { createAvatar } from "@dicebear/core"
import * as funEmoji from "@dicebear/fun-emoji"
import * as lorelei from "@dicebear/lorelei"
import * as micah from "@dicebear/micah"
import * as pixelArt from "@dicebear/pixel-art"

export const avatarStyles = [
  "adventurer",
  "adventurer-neutral",
  "avataaars",
  "bottts",
  "fun-emoji",
  "lorelei",
  "micah",
  "pixel-art",
] as const

export type AvatarStyleId = (typeof avatarStyles)[number]

const styleModules: Record<
  AvatarStyleId,
  Parameters<typeof createAvatar>[0]
> = {
  adventurer,
  "adventurer-neutral": adventurerNeutral,
  avataaars,
  bottts,
  "fun-emoji": funEmoji,
  lorelei,
  micah,
  "pixel-art": pixelArt,
}

function resolveStyle(style: string): AvatarStyleId {
  if ((avatarStyles as readonly string[]).includes(style)) {
    return style as AvatarStyleId
  }
  return "adventurer"
}

/** Generate a same-origin SVG data URI (no third-party request). */
export function avatarDataUri(style: string, seed: string): string {
  const avatar = createAvatar(styleModules[resolveStyle(style)], {
    seed,
  })
  return avatar.toDataUri()
}
