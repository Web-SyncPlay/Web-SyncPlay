import { keys } from "@/server/redis/keys"
import type { PresenceBatchPayload, PresencePatch } from "@/contracts/types"
import type { PresenceEnvelope } from "./channels"
import type { PublishCapture } from "./control-publisher"
import { publishTyped } from "./control-publisher"
import { nextPresenceRevision } from "./presence-seq"

export async function flushPresenceBatch(options: {
  roomId: string
  participants: Record<string, PresencePatch>
  captureOnly: boolean
  captured: PublishCapture[]
}) {
  if (Object.keys(options.participants).length === 0) return

  const presenceRevision = await nextPresenceRevision(options.roomId, {
    captureOnly: options.captureOnly,
  })
  const payload: PresenceBatchPayload = {
    presenceRevision,
    participants: options.participants,
    serverNowMs: Date.now(),
  }
  const envelope: PresenceEnvelope = { type: "presence:batch", payload }
  await publishTyped({
    roomId: options.roomId,
    channel: keys.roomPresenceChannel(options.roomId),
    envelope,
    captureOnly: options.captureOnly,
    captured: options.captured,
  })
}

/** Merge a presence patch into the dirty map (strips per-connection reports). */
export function mergePresenceDirty(
  dirty: Map<string, PresencePatch>,
  userId: string,
  patch: PresencePatch,
) {
  const prev = dirty.get(userId) ?? {}
  // Never fan out per-connection report maps — clients only see the aggregate.
  const { localPlaybackReports: _incoming, ...clientPatch } = patch
  const { localPlaybackReports: _prev, ...prevClient } = prev
  dirty.set(userId, {
    ...prevClient,
    ...clientPatch,
    localPlayback: clientPatch.localPlayback ?? prevClient.localPlayback,
  })
}
