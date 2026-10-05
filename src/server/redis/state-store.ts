import { env } from "@/env"
import { extractMetadata } from "@/server/media/yt-dlp"
import { roomStateTtlSeconds, type RoomState } from "@/zod/types"
import { getCommandClient } from "./client"
import { keys } from "./keys"

const fallbackDefaults = [
  { title: "Fallback media", url: env.FALLBACK_DEFAULT_MEDIA_URL },
]

export class RoomStateStore {
  async get(roomId: string) {
    const client = await getCommandClient()
    const raw = await client.get(keys.roomState(roomId))
    return raw ? (JSON.parse(raw) as RoomState) : null
  }

  /**
   * Optimistic lock: WATCH room key, read, mutate, SET + PUBLISH in MULTI/EXEC.
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
    const channel = keys.roomChannel(roomId)

    const maxAttempts = 12
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await client.watch(stateKey)
      const raw = await client.get(stateKey)
      const current = raw ? (JSON.parse(raw) as RoomState) : null
      const next = await mutate(current)
      if (next === null) {
        await client.unwatch()
        return null
      }

      const payload = JSON.stringify(next)
      const execResult = await client
        .multi()
        .set(stateKey, payload, { EX: roomStateTtlSeconds })
        .publish(channel, payload)
        .exec()

      if (execResult !== null) {
        return next
      }

      await client.unwatch()
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(50 * 2 ** attempt, 400)),
      )
    }

    throw new Error("updateRoom: WATCH retry exhausted")
  }

  async delete(roomId: string) {
    const client = await getCommandClient()
    const stateKey = keys.roomState(roomId)
    const presenceKey = keys.roomPresenceRef(roomId)
    await client.del([stateKey, presenceKey])
  }

  async listRoomIds(): Promise<string[]> {
    const client = await getCommandClient()
    const redisIds: string[] = []
    let cursor = "0"
    do {
      const result = await client.scan(cursor, {
        MATCH: "room:*:state",
        COUNT: 500,
      })
      cursor = result.cursor

      for (const key of result.keys) {
        const roomId = key
          .replace(/^room:/, "")
          .replace(/:state$/, "")
          .trim()
        if (roomId) {
          redisIds.push(roomId)
        }
      }
    } while (cursor !== "0")

    return [...new Set(redisIds)]
  }

  async getDailyDefaults(): Promise<Array<{ title: string; url: string }>> {
    const client = await getCommandClient()
    const raw = await client.get(keys.dailyDefaults())
    const defaults = raw
      ? (JSON.parse(raw) as Array<{ title: string; url: string }>)
      : []

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

  async setDailyDefaults(videos: Array<{ title: string; url: string }>) {
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

  /** Refresh TTL while the room is active (optional heartbeat for presence hash). */
  async touchWsPresence(roomId: string, userId: string) {
    void userId
    const client = await getCommandClient()
    const hkey = keys.roomPresenceRef(roomId)
    await client.expire(hkey, roomStateTtlSeconds)
  }

  /** User IDs with at least one active WS connection cluster-wide. */
  async getWsPresenceUserIds(roomId: string) {
    const client = await getCommandClient()
    const hkey = keys.roomPresenceRef(roomId)
    const entries = await client.hGetAll(hkey)
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
    if (!raw) {
      await client.set(dk, JSON.stringify(fallbackDefaults), {
        EX: roomStateTtlSeconds,
      })
      return
    }

    const parsed = JSON.parse(raw) as Array<{ title: string; url: string }>
    if (Array.isArray(parsed) && parsed.length > 0) {
      return
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
  return storeSingleton
}
