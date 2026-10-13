import type { PresencePatch, RoomState } from "@/contracts/types"
import type { LocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import { createLocalMediaSfuPort } from "@/server/media/local-media-sfu-port"
import type { MediaResolvePort } from "@/server/media/media-resolve-port"
import { createMediaResolvePort } from "@/server/media/media-resolve-port"

/** Playlist / landing default media entry persisted under `defaults:daily-top-10`. */
export type DailyDefaultVideo = { title: string; url: string }

/** Room store port; tests may supply an in-memory adapter. Production: {@link RoomStateStore}. */
export interface RoomStateStorePort {
  get(roomId: string): Promise<RoomState | null>
  /** Persist only — does not publish (callers use RoomBroadcastBus). */
  updateRoom(
    roomId: string,
    mutate: (
      state: RoomState | null,
    ) => RoomState | null | Promise<RoomState | null>,
  ): Promise<RoomState | null>
  delete(roomId: string): Promise<void>
  listRoomIds(): Promise<string[]>

  getDailyDefaults(): Promise<DailyDefaultVideo[]>
  setDailyDefaults(videos: DailyDefaultVideo[]): Promise<void>
  seedDailyDefaultsIfEmpty(): Promise<void>

  addWsConnectionRef(roomId: string, userId: string): Promise<void>
  removeWsConnectionRef(roomId: string, userId: string): Promise<void>
  /** Join rollback / explicit clear. */
  clearWsConnectionRef(roomId: string, userId: string): Promise<void>
  touchWsPresence(
    roomId: string,
    userId: string,
    options?: { force?: boolean },
  ): Promise<void>
  /** Read-only online set (no HASH writes) — safe near WATCH mutate paths. */
  readWsPresenceUserIds(roomId: string): Promise<Set<string>>
  /** HASH writes; call outside WATCH — never inside `updateRoom` mutate. */
  reconcilePresenceRefs(roomId: string): Promise<void>
  /**
   * Read + reconcile in one pass (HASH writes). Prefer
   * {@link readWsPresenceUserIds} + {@link reconcilePresenceRefs} outside WATCH.
   */
  getWsPresenceUserIds(roomId: string): Promise<Set<string>>

  mergePresenceData(
    roomId: string,
    userId: string,
    patch: PresencePatch,
  ): Promise<void>
  /** HGET — prefer over {@link getPresenceDataAll} on hot paths. */
  getPresenceData(roomId: string, userId: string): Promise<PresencePatch | null>
  getPresenceDataAll(roomId: string): Promise<Record<string, PresencePatch>>
  clearPresenceData(roomId: string): Promise<void>
}

/**
 * Pub/sub → local fan-out. Keeps redis modules from importing
 * {@link RoomBroadcastBus} (breaks redis ↔ realtime cycle).
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

/** Media reclaim / stale-upstream callbacks without deep-importing realtime services. */
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

export type { LocalMediaSfuPort, MediaResolvePort }

type PortSlot = {
  roomPublish: RoomPublishPort | null
  mediaMaintenance: MediaMaintenancePort | null
  localMediaSfu: LocalMediaSfuPort | null
  mediaResolve: MediaResolvePort | null
}

function getPortSlot(): PortSlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayRealtimePorts?: Partial<PortSlot>
  }
  const slot = (g.__webSyncPlayRealtimePorts ??= {})
  slot.roomPublish ??= null
  slot.mediaMaintenance ??= null
  slot.localMediaSfu ??= null
  slot.mediaResolve ??= null
  return slot as PortSlot
}

export function setRoomPublishPort(port: RoomPublishPort | null) {
  getPortSlot().roomPublish = port
}

export function getRoomPublishPort(): RoomPublishPort | null {
  return getPortSlot().roomPublish
}

export function setMediaMaintenancePort(port: MediaMaintenancePort | null) {
  getPortSlot().mediaMaintenance = port
}

export function getMediaMaintenancePort(): MediaMaintenancePort | null {
  return getPortSlot().mediaMaintenance
}

export function setLocalMediaSfuPort(port: LocalMediaSfuPort | null) {
  getPortSlot().localMediaSfu = port
}

export function getLocalMediaSfuPort(): LocalMediaSfuPort {
  const slot = getPortSlot()
  // Lazy default when tests import handlers without wireRealtimePorts.
  slot.localMediaSfu ??= createLocalMediaSfuPort()
  return slot.localMediaSfu
}

export function setMediaResolvePort(port: MediaResolvePort | null) {
  getPortSlot().mediaResolve = port
}

export function getMediaResolvePort(): MediaResolvePort {
  const slot = getPortSlot()
  // Lazy default when tests import playlist-resolve without wireRealtimePorts.
  slot.mediaResolve ??= createMediaResolvePort()
  return slot.mediaResolve
}
