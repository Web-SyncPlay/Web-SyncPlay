import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type { RoomStateStorePort } from "@/server/ports"
import {
  aggregateLocalPlaybackReports,
  clientPresencePatch,
  removeLocalPlaybackReport,
} from "@/server/realtime/services/local-playback-presence"

/**
 * Drop one connection's playback sample and republish the re-aggregated user slot.
 * No-op when the connection had no report.
 */
export async function clearConnectionLocalPlaybackReport(
  store: RoomStateStorePort,
  roomId: string,
  userId: string,
  connectionId: string,
): Promise<void> {
  const presenceAll = await store.getPresenceDataAll(roomId)
  const existing = presenceAll[userId]
  const reports = existing?.localPlaybackReports
  if (!reports || !(connectionId in reports)) {
    return
  }

  const now = Date.now()
  const nextReports = removeLocalPlaybackReport(reports, connectionId, now)
  const aggregated =
    aggregateLocalPlaybackReports(nextReports, now) ?? existing.localPlayback

  const patch = {
    ...existing,
    lastSeenAt: now,
    localPlayback: aggregated,
    localPlaybackReports: nextReports,
  }
  await store.mergePresenceData(roomId, userId, patch)

  const bus = getRoomBroadcastBus()
  bus.attachStore(store)
  bus.markPresenceDirty(roomId, userId, clientPresencePatch(patch))
}
