import { env } from "@/env"
import { extractMetadata } from "@/server/media/yt-dlp"
import { getRoomBroadcastBus } from "@/server/realtime/broadcast/room-broadcast-bus"
import type {
  DailyDefaultVideo,
  RoomStateStorePort,
} from "@/server/realtime/ports"
import {
  roomStateTtlSeconds,
  type PresencePatch,
  type RoomState,
} from "@/zod/types"
import { getCommandClient } from "./client"
import { keys } from "./keys"

const fallbackDefaults: DailyDefaultVideo[] = [
  { title: "Fallback media", url: env.FALLBACK_DEFAULT_MEDIA_URL },
]

const UPDATE_ROOM_MAX_ATTEMPTS = 12
const UPDATE_ROOM_BACKOFF_BASE_MS = 50
const UPDATE_ROOM_BACKOFF_CAP_MS = 400

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T
}

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Room-scoped keys that share the room TTL / delete lifecycle. */
function roomLifecycleKeys(roomId: string): string[] {
  return [
    keys.roomState(roomId),
    keys.roomPresenceRef(roomId),
    keys.roomPresenceData(roomId),
    keys.roomIdentity(roomId),
  ]
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export class RoomStateStore implements RoomStateStorePort {
  async get(roomId: string) {
    const client = await getCommandClient()
    const raw = await client.get(keys.roomState(roomId))
    return raw ? parseJson<RoomState>(raw) : null
  }

  /**
   * Optimistic lock: WATCH room key, read, mutate, SET in MULTI/EXEC.
   * Persist-only — RoomBroadcastBus owns fan-out.
   * Retries on WATCH conflict. Returns null if mutate returns null (abort, no write).
   */
  async updateRoom(
    roomId: string,
    mutate: (
      state: RoomState | null,
    ) => RoomState | null | Promise<RoomState | null>,
  ) {
    const client = await getCommandClient()
    const stateKey = keys.roomState(roomId)

    for (let attempt = 0; attempt < UPDATE_ROOM_MAX_ATTEMPTS; attempt += 1) {
      await client.watch(stateKey)
      const raw = await client.get(stateKey)
      const current = raw ? parseJson<RoomState>(raw) : null
      const next = await mutate(current)
      if (next === null) {
        await client.unwatch()
        return null
      }

      const execResult = await client
        .multi()
        .set(stateKey, JSON.stringify(next), { EX: roomStateTtlSeconds })
        .exec()

      if (execResult !== null) {
        return next
      }

      await client.unwatch()
      await sleep(
        Math.min(
          UPDATE_ROOM_BACKOFF_BASE_MS * 2 ** attempt,
          UPDATE_ROOM_BACKOFF_CAP_MS,
        ),
      )
    }

    throw new Error("updateRoom: WATCH retry exhausted")
  }

  async delete(roomId: string) {
    const client = await getCommandClient()
    await client.del(roomLifecycleKeys(roomId))
    getRoomBroadcastBus().clearRoom(roomId)
  }

  async mergePresenceData(
    roomId: string,
    userId: string,
    patch: PresencePatch,
  ) {
    const client = await getCommandClient()
    const hkey = keys.roomPresenceData(roomId)
    const existingRaw = await client.hGet(hkey, userId)
    const existing = existingRaw
      ? (tryParseJson<PresencePatch>(existingRaw) ?? {})
      : {}
    const merged: PresencePatch = {
      ...existing,
      ...patch,
      localPlayback: patch.localPlayback ?? existing.localPlayback,
    }
    await client.hSet(hkey, { [userId]: JSON.stringify(merged) })
    await client.expire(hkey, roomStateTtlSeconds)
  }

  async getPresenceDataAll(roomId: string) {
    const client = await getCommandClient()
    const entries = await client.hGetAll(keys.roomPresenceData(roomId))
    const out: Record<string, PresencePatch> = {}
    for (const [userId, raw] of Object.entries(entries)) {
      const parsed = tryParseJson<PresencePatch>(raw)
      if (parsed) {
        out[userId] = parsed
      }
    }
    return out
  }

  async clearPresenceData(roomId: string) {
    const client = await getCommandClient()
    await client.del([keys.roomPresenceData(roomId)])
  }

  async listRoomIds(): Promise<string[]> {
    const client = await getCommandClient()
    const redisIds: string[] = []
    let cursor = "0"
    do {
      const result = await client.scan(cursor, {
        MATCH: keys.roomStateScanPattern(),
        COUNT: 500,
      })
      cursor = result.cursor

      for (const key of result.keys) {
        const roomId = keys.parseRoomStateKey(key)
        if (roomId) {
          redisIds.push(roomId)
        }
      }
    } while (cursor !== "0")

    return [...new Set(redisIds)]
  }

  async getDailyDefaults(): Promise<DailyDefaultVideo[]> {
    const client = await getCommandClient()
    const raw = await client.get(keys.dailyDefaults())
    const defaults = raw ? parseJson<DailyDefaultVideo[]>(raw) : []

    let didHydrateMissingTitle = false
    const normalized = await Promise.all(
      defaults.map(async (entry) => {
        const cleanTitle = entry.title?.trim() ?? ""
        if (cleanTitle) return { title: cleanTitle, url: entry.url }

        const metadata = await extractMetadata(entry.url)
        const hydratedTitle = metadata.title ?? "Resolved media"
        didHydrateMissingTitle = true
        return { title: hydratedTitle, url: entry.url }
      }),
    )

    if (didHydrateMissingTitle) {
      await this.setDailyDefaults(normalized)
    }

    return normalized
  }

  async setDailyDefaults(videos: DailyDefaultVideo[]) {
    const client = await getCommandClient()
    await client.set(keys.dailyDefaults(), JSON.stringify(videos), {
      EX: roomStateTtlSeconds,
    })
  }

  /** Increment refcount for one WebSocket connection (call on join / upgrade). */
  async addWsConnectionRef(roomId: string, userId: string) {
    const client = await getCommandClient()
    const hkey = keys.roomPresenceRef(roomId)
    await client.hIncrBy(hkey, userId, 1)
    await client.expire(hkey, roomStateTtlSeconds)
  }

  /** Decrement refcount; removes user from presence when last connection closes. */
  async removeWsConnectionRef(roomId: string, userId: string) {
    const client = await getCommandClient()
    const hkey = keys.roomPresenceRef(roomId)
    const n = Number(await client.hIncrBy(hkey, userId, -1))
    if (!Number.isFinite(n) || n <= 0) {
      await client.hDel(hkey, userId)
    }
    await client.expire(hkey, roomStateTtlSeconds)
  }

  /** Refresh TTL while the room is active (all room-related keys). */
  async touchWsPresence(roomId: string, _userId: string) {
    const client = await getCommandClient()
    const multi = client.multi()
    for (const key of roomLifecycleKeys(roomId)) {
      multi.expire(key, roomStateTtlSeconds)
    }
    await multi.exec()
  }

  /** User IDs with at least one active WS connection cluster-wide. */
  async getWsPresenceUserIds(roomId: string) {
    const client = await getCommandClient()
    const entries = await client.hGetAll(keys.roomPresenceRef(roomId))
    const online = new Set<string>()
    for (const [uid, raw] of Object.entries(entries)) {
      const n = Number.parseInt(raw, 10)
      if (Number.isFinite(n) && n > 0) {
        online.add(uid)
      }
    }
    return online
  }

  async seedDailyDefaultsIfEmpty() {
    const client = await getCommandClient()
    const dk = keys.dailyDefaults()
    const raw = await client.get(dk)
    if (raw) {
      const parsed = tryParseJson<DailyDefaultVideo[]>(raw)
      if (Array.isArray(parsed) && parsed.length > 0) {
        return
      }
    }

    await client.set(dk, JSON.stringify(fallbackDefaults), {
      EX: roomStateTtlSeconds,
    })
  }
}

let storeSingleton: RoomStateStore | null = null

export async function getRoomStateStore() {
  if (!storeSingleton) {
    storeSingleton = new RoomStateStore()
  }
  await getCommandClient()
  await storeSingleton.seedDailyDefaultsIfEmpty()
  getRoomBroadcastBus().attachStore(storeSingleton)
  return storeSingleton
}
