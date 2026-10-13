import { isProcessDraining } from "@/server/lifecycle"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import { EMPTY_ROOM_DESTROY_GRACE_MS } from "@/shared/room-lifecycle"

/** TTL so a stale emptyAt cannot outlive the room idle retention. */
const EMPTY_AT_TTL_SECONDS = Math.ceil((EMPTY_ROOM_DESTROY_GRACE_MS * 4) / 1000)

/** Minimal Redis surface used by empty-room markers (test-injectable). */
type EmptyAtClient = {
  set: (
    key: string,
    value: string,
    opts?: { NX?: boolean; EX?: number },
  ) => Promise<unknown>
  get: (key: string) => Promise<string | null>
  del: (key: string) => Promise<unknown>
}

let emptyAtClientForTests: EmptyAtClient | null = null

/**
 * Test-only: inject an in-memory emptyAt client so suites do not need
 * `mock.module` on `@/server/redis/client` (preload / cross-file races).
 */
export function setEmptyAtClientForTests(client: EmptyAtClient | null): void {
  emptyAtClientForTests = client
}

type NoteEmptyPresenceFn = (roomId: string, nowMs?: number) => Promise<boolean>

let noteEmptyPresenceForTests: NoteEmptyPresenceFn | null = null

/**
 * Test-only: stub destroy decisions for cleanup/disconnect without
 * `mock.module` on this file (which poisons empty-room unit tests).
 */
export function setNoteEmptyPresenceForTests(
  fn: NoteEmptyPresenceFn | null,
): void {
  noteEmptyPresenceForTests = fn
}

async function emptyAtClient(): Promise<EmptyAtClient> {
  if (emptyAtClientForTests) return emptyAtClientForTests
  return getCommandClient()
}

/**
 * Mark room empty (NX). First writer wins so grace starts at the first
 * zero-presence observation across replicas.
 */
export async function markRoomEmptyIfAbsent(
  roomId: string,
  nowMs = Date.now(),
): Promise<void> {
  try {
    const client = await emptyAtClient()
    await client.set(keys.roomEmptyAt(roomId), String(nowMs), {
      NX: true,
      EX: EMPTY_AT_TTL_SECONDS,
    })
  } catch (error) {
    console.warn("[empty-room] mark emptyAt failed", error)
  }
}

/** Clear emptyAt when presence returns (join / reconnect). */
export async function clearRoomEmptyMarker(roomId: string): Promise<void> {
  try {
    const client = await emptyAtClient()
    await client.del(keys.roomEmptyAt(roomId))
  } catch (error) {
    console.warn("[empty-room] clear emptyAt failed", error)
  }
}

/**
 * True when emptyAt exists and grace has elapsed.
 * Missing marker → not yet ready to destroy (caller should mark first).
 * Fail-closed on Redis errors (do not destroy).
 */
export async function isEmptyRoomGraceElapsed(
  roomId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  try {
    const client = await emptyAtClient()
    const raw = await client.get(keys.roomEmptyAt(roomId))
    if (raw == null || raw === "") return false
    const emptyAt = Number.parseInt(raw, 10)
    if (!Number.isFinite(emptyAt)) return false
    return nowMs - emptyAt >= EMPTY_ROOM_DESTROY_GRACE_MS
  } catch (error) {
    console.warn("[empty-room] read emptyAt failed", error)
    return false
  }
}

/**
 * Whether this process may destroy an empty room now.
 * Skips while draining so rolling restart does not wipe Valkey rooms.
 */
export function mayDestroyEmptyRoomOnThisProcess(): boolean {
  return !isProcessDraining()
}

/**
 * After presence is empty: mark emptyAt and return whether grace already
 * elapsed (so the caller can destroy). During drain, always mark and never
 * destroy from this process.
 */
export async function noteEmptyPresenceAndShouldDestroy(
  roomId: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (noteEmptyPresenceForTests) {
    return noteEmptyPresenceForTests(roomId, nowMs)
  }
  await markRoomEmptyIfAbsent(roomId, nowMs)
  if (!mayDestroyEmptyRoomOnThisProcess()) {
    return false
  }
  return await isEmptyRoomGraceElapsed(roomId, nowMs)
}
