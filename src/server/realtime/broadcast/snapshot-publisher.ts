import { keys } from "@/server/redis/keys"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import type { SnapshotEnvelope } from "./channels"
import type { PublishCapture } from "./control-publisher"
import { publishTyped } from "./control-publisher"
import { buildSanitizedSnapshot, structuralHash } from "./snapshot-build"

export async function flushSnapshotPublish(options: {
  roomId: string
  store: RoomStateStorePort | null
  lastStructuralHash: string | undefined
  captureOnly: boolean
  captured: PublishCapture[]
}): Promise<string | undefined> {
  const payload = await buildSanitizedSnapshot(options.store, options.roomId)
  if (!payload) return options.lastStructuralHash

  const hash = structuralHash(payload)
  if (options.lastStructuralHash === hash) {
    return options.lastStructuralHash
  }

  const envelope: SnapshotEnvelope = { type: "room:snapshot", payload }
  await publishTyped({
    roomId: options.roomId,
    channel: keys.roomSnapshotChannel(options.roomId),
    envelope,
    captureOnly: options.captureOnly,
    captured: options.captured,
  })
  return hash
}
