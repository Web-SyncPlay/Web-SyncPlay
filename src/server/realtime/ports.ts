import type { PresencePatch, RoomState } from "@/zod/types"

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
  touchWsPresence(roomId: string, userId: string): Promise<void>
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
