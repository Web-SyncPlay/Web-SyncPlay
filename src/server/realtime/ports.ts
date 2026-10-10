import type { LocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import { createLocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import type { PresencePatch, RoomState } from "@/contracts/types"

/** Playlist / landing default media entry persisted under `defaults:daily-top-10`. */
export type DailyDefaultVideo = { title: string; url: string }

/**
 * Port used by realtime handlers/services so unit tests can supply an in-memory store
 * without Redis. {@link RoomStateStore} is the production adapter.
 */
export interface RoomStateStorePort {
  // --- Room state ---
  get(roomId: string): Promise<RoomState | null>
  /**
   * Persist room state only — does not publish. Callers use RoomBroadcastBus.
   */
  updateRoom(
    roomId: string,
    mutate: (
      state: RoomState | null,
    ) => RoomState | null | Promise<RoomState | null>,
  ): Promise<RoomState | null>
  delete(roomId: string): Promise<void>
  listRoomIds(): Promise<string[]>

  // --- Daily defaults ---
  getDailyDefaults(): Promise<DailyDefaultVideo[]>
  setDailyDefaults(videos: DailyDefaultVideo[]): Promise<void>
  seedDailyDefaultsIfEmpty(): Promise<void>

  // --- WS connection presence (HASH refcounts) ---
  addWsConnectionRef(roomId: string, userId: string): Promise<void>
  removeWsConnectionRef(roomId: string, userId: string): Promise<void>
  /** Drop one user's presence field (join rollback / explicit clear). */
  clearWsConnectionRef(roomId: string, userId: string): Promise<void>
  touchWsPresence(
    roomId: string,
    userId: string,
    options?: { force?: boolean },
  ): Promise<void>
  getWsPresenceUserIds(roomId: string): Promise<Set<string>>

  // --- Presence data HASH (localPlayback clocks, etc.) ---
  /** Merge presence fields for one user into the presence HASH. */
  mergePresenceData(
    roomId: string,
    userId: string,
    patch: PresencePatch,
  ): Promise<void>
  getPresenceDataAll(roomId: string): Promise<Record<string, PresencePatch>>
  clearPresenceData(roomId: string): Promise<void>
}

/**
 * Pub/sub → local fan-out surface used by redis state-store / pubsub so those
 * modules do not import {@link RoomBroadcastBus} (breaks redis ↔ realtime cycle).
 * Production adapter: RoomBroadcastBus.
 */
export interface RoomPublishPort {
  attachStore(store: RoomStateStorePort): void
  clearRoom(roomId: string): void
  fanOutFromPubSub(
    roomId: string,
    wired: {
      type: string
      payload: unknown
      originNodeId?: string
      requestId?: string
    },
  ): void
  fanOutUserEphemeral(
    roomId: string,
    targetUserId: string,
    envelope: { type: string; requestId?: string; payload: unknown },
  ): void
}

/**
 * Media reclaim / stale-upstream callbacks so media modules do not deeply import
 * realtime playlist-resolve / cleanup / participants services.
 */
export interface MediaMaintenancePort {
  reresolveRemotePlaylistItem(params: {
    store: RoomStateStorePort
    roomId: string
    itemId: string
  }): Promise<boolean>
  cleanupInactiveRooms(store: RoomStateStorePort): Promise<{
    scannedRooms: number
    removedRooms: number
    removedParticipants: number
  }>
  processDuePrunes(store: RoomStateStorePort): Promise<number>
}

export type { LocalMediaSfuPort }

type PortSlot = {
  roomPublish: RoomPublishPort | null
  mediaMaintenance: MediaMaintenancePort | null
  localMediaSfu: LocalMediaSfuPort | null
}

function getPortSlot(): PortSlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayRealtimePorts?: PortSlot
  }
  g.__webSyncPlayRealtimePorts ??= {
    roomPublish: null,
    mediaMaintenance: null,
    localMediaSfu: null,
  }
  return g.__webSyncPlayRealtimePorts
}

/** Composition-root wiring (realtime-server / maintenance / tests). */
export function setRoomPublishPort(port: RoomPublishPort | null) {
  getPortSlot().roomPublish = port
}

export function getRoomPublishPort(): RoomPublishPort | null {
  return getPortSlot().roomPublish
}

/** Composition-root wiring (realtime-server / maintenance / tests). */
export function setMediaMaintenancePort(port: MediaMaintenancePort | null) {
  getPortSlot().mediaMaintenance = port
}

export function getMediaMaintenancePort(): MediaMaintenancePort | null {
  return getPortSlot().mediaMaintenance
}

/** Composition-root wiring (realtime-server / tests). */
export function setLocalMediaSfuPort(port: LocalMediaSfuPort | null) {
  getPortSlot().localMediaSfu = port
}

export function getLocalMediaSfuPort(): LocalMediaSfuPort {
  const slot = getPortSlot()
  // Lazy default so unit tests that import handlers without wireRealtimePorts
  // still get a working process-local adapter.
  slot.localMediaSfu ??= createLocalMediaSfuPort()
  return slot.localMediaSfu
}
