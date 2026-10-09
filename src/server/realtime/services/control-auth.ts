import { validateControlToken } from "@/server/realtime/services/control-token"
import type { SessionKind } from "@/zod/types"

/**
 * Resolves whether a joining socket is a control session and whether it is
 * authorized to mutate. Control embeds require a valid minted control token.
 */
export async function authorizeControlSession(input: {
  sessionKind: SessionKind
  controlToken: string | undefined
  roomId: string
  userId: string
}): Promise<{ isControlSession: boolean; controlAuthorized: boolean }> {
  const isControlSession = input.sessionKind === "control"
  if (!isControlSession) {
    return { isControlSession: false, controlAuthorized: false }
  }

  let controlAuthorized = false
  if (input.controlToken) {
    controlAuthorized = await validateControlToken({
      token: input.controlToken,
      roomId: input.roomId,
      userId: input.userId,
    })
  }

  return { isControlSession, controlAuthorized }
}
