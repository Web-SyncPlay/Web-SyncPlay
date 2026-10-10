import { createLocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import {
  setLocalMediaSfuPort,
  setMediaMaintenancePort,
  setRoomPublishPort,
} from "@/server/realtime/ports"
import { cleanupInactiveRooms } from "@/server/realtime/services/cleanup"
import { processDuePrunes } from "@/server/realtime/services/participants"
import { reresolveRemotePlaylistItem } from "@/server/realtime/services/playlist-resolve"

/**
 * Idempotent composition-root wiring: redis pubsub/state-store and media
 * reclaim/stale-refresh receive ports without importing broadcast bus / services.
 */
export function wireRealtimePorts() {
  setRoomPublishPort(getRoomBroadcastBus())
  setMediaMaintenancePort({
    reresolveRemotePlaylistItem,
    cleanupInactiveRooms,
    processDuePrunes,
  })
  setLocalMediaSfuPort(createLocalMediaSfuPort())
}
