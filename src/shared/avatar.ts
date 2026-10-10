import { Avatar, Style } from "@dicebear/core"
import adventurer from "@dicebear/styles/adventurer.json" with { type: "json" }
import avataaars from "@dicebear/styles/avataaars.json" with { type: "json" }
import lorelei from "@dicebear/styles/lorelei.json" with { type: "json" }

export const DEFAULT_AVATAR_STYLE = "adventurer" as const

export const avatarStyles = [
  "adventurer",
  "avataaars",
  "lorelei",
] as const

export type AvatarStyleId = (typeof avatarStyles)[number]

const styleModules: Record<AvatarStyleId, Style> = {
  adventurer: new Style(adventurer),
  avataaars: new Style(avataaars),
  lorelei: new Style(lorelei),
}

const styleLabels: Record<AvatarStyleId, string> = {
  adventurer: "Adventurer",
  avataaars: "Avataaars",
  lorelei: "Lorelei",
}

export function isAvatarStyleId(style: string): style is AvatarStyleId {
  return (avatarStyles as readonly string[]).includes(style)
}

export function avatarStyleLabel(style: AvatarStyleId): string {
  return styleLabels[style]
}

export function resolveStyle(style: string): AvatarStyleId {
  return isAvatarStyleId(style) ? style : DEFAULT_AVATAR_STYLE
}

/** Generate a same-origin SVG data URI (no third-party request). */
export function avatarDataUri(style: string, seed: string): string {
  return new Avatar(styleModules[resolveStyle(style)], { seed }).toDataUri()
}
