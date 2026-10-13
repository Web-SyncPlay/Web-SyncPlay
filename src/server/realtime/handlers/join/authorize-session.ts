import type { SessionKind } from "@/contracts/types"
import { authorizeControlSession } from "@/server/realtime/services/control-auth"

export async function authorizeJoinSession(options: {
  sessionKind: SessionKind
  controlToken: string | undefined
  roomId: string
  userId: string
}) {
  return await authorizeControlSession(options)
}
