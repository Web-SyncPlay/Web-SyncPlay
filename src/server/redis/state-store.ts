import { env } from "@/env"
import {
  dailyDefaultsForRead,
  hydrateMissingDailyDefaultTitles,
} from "@/server/redis/daily-defaults"
import { getAppNodeId } from "@/server/node-id"
import { listAliveAppNodeIds } from "@/server/node-heartbeat"
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
import {
  encodePresenceNodeCounts,
  parsePresenceNodeCounts,
} from "./presence-ref"

const fallbackDefaults: DailyDefaultVideo[] = [
  { title: "Fallback media", url: env.FALLBACK_DEFAULT_MEDIA_URL },
]

const UPDATE_ROOM_MAX_ATTEMPTS = 12
const UPDATE_ROOM_BACKOFF_BASE_MS = 50
const UPDATE_ROOM_BACKOFF_CAP_MS = 400

/**
 * Atomic node-map presence bump: HGET → decode → adjust nodeId → HSET/HDEL + EXPIRE.
 * Legacy plain-integer fields are treated as empty (orphaned) maps.
 * KEYS[1]=hash  ARGV[1]=userId  ARGV[2]=nodeId  ARGV[3]=delta  ARGV[4]=ttlSeconds
 * Returns remaining total refcount for the user (0 if field removed).
 */
const PRESENCE_BUMP_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
local counts = {}
if raw and raw ~= '' then
  local asInt = tonumber(raw)
  if not (asInt and tostring(asInt) == raw) then
    local ok, parsed = pcall(cjson.decode, raw)
    if ok and type(parsed) == 'table' then
      counts = parsed
    end
  end
end

local nodeId = ARGV[2]
local delta = tonumber(ARGV[3]) or 0
local n = (tonumber(counts[nodeId]) or 0) + delta
if n <= 0 then
  counts[nodeId] = nil
else
  counts[nodeId] = math.floor(n)
end

local cleaned = {}
local remaining = 0
for k, v in pairs(counts) do
  local vn = tonumber(v)
  if vn and vn > 0 and type(k) == 'string' and #k > 0 then
    cleaned[k] = math.floor(vn)
    remaining = remaining + vn
  end
end

if remaining <= 0 then
  redis.call('HDEL', KEYS[1], ARGV[1])
else
  redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(cleaned))
end
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
return remaining
`

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
      localPlaybackReports:
        patch.localPlaybackReports ?? existing.localPlaybackReports,
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
    return dailyDefaultsForRead(defaults)
  }

  /** Maintenance: resolve missing default titles via yt-dlp and persist. */
  async hydrateDailyDefaultTitlesIfNeeded(): Promise<number> {
    const client = await getCommandClient()
    const raw = await client.get(keys.dailyDefaults())
    const defaults = raw ? parseJson<DailyDefaultVideo[]>(raw) : []
    const needsHydration = defaults.some((entry) => !entry.title?.trim())
    if (!needsHydration) {
      return 0
    }

    const { videos, hydratedCount } =
      await hydrateMissingDailyDefaultTitles(defaults)
    if (hydratedCount > 0) {
      await this.setDailyDefaults(videos)
    }
    return hydratedCount
  }

  async setDailyDefaults(videos: DailyDefaultVideo[]) {
    const client = await getCommandClient()
    await client.set(keys.dailyDefaults(), JSON.stringify(videos), {
      EX: roomStateTtlSeconds,
    })
  }

  /** Increment this node's WS refcount for a user (call on join). */
  async addWsConnectionRef(roomId: string, userId: string) {
    await this.bumpWsConnectionRef(roomId, userId, 1)
  }

  /** Decrement this node's WS refcount; removes the user when all nodes are zero. */
  async removeWsConnectionRef(roomId: string, userId: string) {
    await this.bumpWsConnectionRef(roomId, userId, -1)
  }

  /**
   * Atomic presence node-map adjust for this process's node id.
   * Prefer {@link addWsConnectionRef} / {@link removeWsConnectionRef}.
   */
  async bumpWsConnectionRef(roomId: string, userId: string, delta: number) {
    if (delta === 0) return
    const client = await getCommandClient()
    const hkey = keys.roomPresenceRef(roomId)
    await client.eval(PRESENCE_BUMP_SCRIPT, {
      keys: [hkey],
      arguments: [
        userId,
        getAppNodeId(),
        String(delta),
        String(roomStateTtlSeconds),
      ],
    })
  }

  /**
   * Remove one user's presence field entirely (join rollback / explicit clear).
   * A1 can call this when a committed join must roll back presence.
   */
  async clearWsConnectionRef(roomId: string, userId: string) {
    const client = await getCommandClient()
    await client.hDel(keys.roomPresenceRef(roomId), userId)
  }

  /** Drop all WS presence refs for a room. */
  async clearWsPresenceRefs(roomId: string) {
    const client = await getCommandClient()
    await client.del([keys.roomPresenceRef(roomId)])
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

  /**
   * User IDs with at least one live WS connection on an alive app node.
   * Orphaned legacy integer refs and dead-node maps are ignored when the alive
   * list is reliable. On unreliable alive fetch, skip hDel / dead-node rewrite.
   */
  async getWsPresenceUserIds(roomId: string) {
    const client = await getCommandClient()
    const entries = await client.hGetAll(keys.roomPresenceRef(roomId))
    const { ids: alive, reliable } = await listAliveAppNodeIds()
    // This process is always considered alive for its own refs (heartbeat race).
    alive.add(getAppNodeId())

    const online = new Set<string>()
    const staleFields: string[] = []
    const hkey = keys.roomPresenceRef(roomId)

    for (const [uid, raw] of Object.entries(entries)) {
      const counts = parsePresenceNodeCounts(raw)
      if (Object.keys(counts).length === 0) {
        // Legacy integer or empty — only drop when alive list is reliable.
        if (reliable) staleFields.push(uid)
        continue
      }

      if (!reliable) {
        // Fail closed: assume remotes may still be alive; do not rewrite/hDel.
        online.add(uid)
        continue
      }

      const liveOnly: Record<string, number> = {}
      for (const [nodeId, n] of Object.entries(counts)) {
        if (n > 0 && alive.has(nodeId)) liveOnly[nodeId] = n
      }

      if (Object.keys(liveOnly).length === 0) {
        staleFields.push(uid)
        continue
      }

      online.add(uid)
      // Drop dead-node refcounts left behind by crashed replicas.
      const encoded = encodePresenceNodeCounts(liveOnly)
      if (encoded && encoded !== raw) {
        await client.hSet(hkey, { [uid]: encoded })
      }
    }

    if (reliable && staleFields.length > 0) {
      await client.hDel(hkey, staleFields)
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
