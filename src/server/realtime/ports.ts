import type { RoomState } from "@/zod/types"

/**
 * Port used by realtime handlers/services so unit tests can supply an in-memory store
 * without Redis. {@link RoomStateStore} is the production adapter.
 */
export interface RoomStateStorePort {
  get(roomId: string): Promise<RoomState | null>
  updateRoom(
    roomId: string,
    mutate: (
      state: RoomState | null,
    ) => RoomState | null | Promise<RoomState | null>,
  ): Promise<RoomState | null>
  delete(roomId: string): Promise<void>
  listRoomIds(): Promise<string[]>
  getDailyDefaults(): Promise<Array<{ title: string; url: string }>>
  setDailyDefaults(
    videos: Array<{ title: string; url: string }>,
  ): Promise<void>
  addWsConnectionRef(roomId: string, userId: string): Promise<void>
  removeWsConnectionRef(roomId: string, userId: string): Promise<void>
  touchWsPresence(roomId: string, userId: string): Promise<void>
  getWsPresenceUserIds(roomId: string): Promise<Set<string>>
  seedDailyDefaultsIfEmpty(): Promise<void>
}
