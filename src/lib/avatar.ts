import * as adventurer from "@dicebear/adventurer"
import * as avataaars from "@dicebear/avataaars"
import { createAvatar } from "@dicebear/core"
import * as lorelei from "@dicebear/lorelei"

export const DEFAULT_AVATAR_STYLE = "adventurer" as const

export const avatarStyles = [
  "adventurer",
  "avataaars",
  "lorelei",
] as const

export type AvatarStyleId = (typeof avatarStyles)[number]

const styleModules: Record<
  AvatarStyleId,
  Parameters<typeof createAvatar>[0]
> = {
  adventurer,
  avataaars,
  lorelei,
}

const styleLabels: Record<AvatarStyleId, string> = {
  adventurer: "Adventurer",
  avataaars: "Avataaars",
  lorelei: "Lorelei",
}

export function avatarStyleLabel(style: AvatarStyleId): string {
  return styleLabels[style]
}

export function resolveStyle(style: string): AvatarStyleId {
  if ((avatarStyles as readonly string[]).includes(style)) {
    return style as AvatarStyleId
  }
  return DEFAULT_AVATAR_STYLE
}

/** Generate a same-origin SVG data URI (no third-party request). */
export function avatarDataUri(style: string, seed: string): string {
  const avatar = createAvatar(styleModules[resolveStyle(style)], {
    seed,
  })
  return avatar.toDataUri()
}
