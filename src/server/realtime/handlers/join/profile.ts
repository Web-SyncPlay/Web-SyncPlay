import type { ParticipantState } from "@/contracts/types"

export function resolveJoinParticipantProfile(
  existingParticipant: ParticipantState | undefined,
  incoming: { username: string; avatarStyle: string },
): { username: string; avatarStyle: string } {
  if (existingParticipant) {
    return {
      username: existingParticipant.username,
      avatarStyle: existingParticipant.avatarStyle,
    }
  }

  return incoming
}
