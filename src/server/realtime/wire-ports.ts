import { createLocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import { createMediaResolvePort } from "@/server/media/media-resolve-port"
import {
  setLocalMediaSfuPort,
  setMediaMaintenancePort,
  setMediaResolvePort,
  setRoomPublishPort,
} from "@/server/ports"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
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
  setMediaResolvePort(createMediaResolvePort())
}
