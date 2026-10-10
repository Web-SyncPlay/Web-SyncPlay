import { getAppNodeId } from "@/server/node-id"
import type { RoomStateStorePort } from "@/server/ports"
import {
  bumpPresenceNodeCount,
  isPresentOnAliveNode,
  totalPresenceRefs,
  type PresenceNodeCounts,
} from "@/server/redis/presence-ref"
import type {
  RoomState,
  SessionKind,
  WsEnvelope,
} from "@/contracts/types"
import type { WebSocket } from "ws"
import type { RoomMessageContext } from "../handlers/types"

export {
  createParticipant,
  createPlaylistItem,
  createRoomState,
} from "@/shared/test-utils/room-fixtures"

export class InMemoryRoomStateStore implements RoomStateStorePort {
  rooms = new Map<string, RoomState>()
  /**
   * Mirrors Redis presence hash: userId → nodeId → refcount.
   * Matches production node-map encoding (not legacy flat integers).
   */
  presence = new Map<string, Map<string, PresenceNodeCounts>>()
  /**
   * Nodes treated as alive for {@link readWsPresenceUserIds} /
   * {@link getWsPresenceUserIds}. Defaults to this process; tests can inject
   * remote/dead nodes.
   */
  aliveNodeIds = new Set<string>([getAppNodeId()])
  /** When false, mirrors fail-closed alive-list fetch (no dead-node filtering). */
  aliveListReliable = true
  presenceData = new Map<string, Map<string, import("@/contracts/types").PresencePatch>>()
  dailyDefaults: Array<{ title: string; url: string }> = []

  constructor(initial?: RoomState) {
    if (initial) {
      this.rooms.set(initial.roomId, structuredClone(initial))
      const refs = new Map<string, PresenceNodeCounts>()
      const nodeId = getAppNodeId()
      for (const participant of Object.values(initial.participants)) {
        if (participant.connected) {
          refs.set(participant.userId, { [nodeId]: 1 })
        }
      }
      this.presence.set(initial.roomId, refs)
    }
  }

  async get(roomId: string) {
    const state = this.rooms.get(roomId)
    return state ? structuredClone(state) : null
  }

  async updateRoom(
    roomId: string,
    mutate: (
      state: RoomState | null,
    ) => RoomState | null | Promise<RoomState | null>,
  ) {
    const current = this.rooms.get(roomId) ?? null
    const next = await mutate(current ? structuredClone(current) : null)
    if (next === null) {
      return null
    }
    this.rooms.set(roomId, next)
    return structuredClone(next)
  }

  async delete(roomId: string) {
    this.rooms.delete(roomId)
    this.presence.delete(roomId)
    this.presenceData.delete(roomId)
  }

  async mergePresenceData(
    roomId: string,
    userId: string,
    patch: import("@/contracts/types").PresencePatch,
  ) {
    const map = this.presenceData.get(roomId) ?? new Map()
    const prev = map.get(userId) ?? {}
    map.set(userId, {
      ...prev,
      ...patch,
      localPlayback: patch.localPlayback ?? prev.localPlayback,
      localPlaybackReports:
        patch.localPlaybackReports ?? prev.localPlaybackReports,
    })
    this.presenceData.set(roomId, map)
  }

  async getPresenceDataAll(roomId: string) {
    const map = this.presenceData.get(roomId)
    if (!map) return {}
    return Object.fromEntries(map.entries())
  }

  async clearPresenceData(roomId: string) {
    this.presenceData.delete(roomId)
  }

  async listRoomIds() {
    return [...this.rooms.keys()]
  }

  async getDailyDefaults() {
    return [...this.dailyDefaults]
  }

  async setDailyDefaults(videos: Array<{ title: string; url: string }>) {
    this.dailyDefaults = [...videos]
  }

  async addWsConnectionRef(roomId: string, userId: string) {
    const refs =
      this.presence.get(roomId) ?? new Map<string, PresenceNodeCounts>()
    const nodeId = getAppNodeId()
    const next = bumpPresenceNodeCount(refs.get(userId) ?? {}, nodeId, 1)
    refs.set(userId, next)
    this.presence.set(roomId, refs)
  }

  async removeWsConnectionRef(roomId: string, userId: string) {
    const refs = this.presence.get(roomId)
    if (!refs) return
    const nodeId = getAppNodeId()
    const next = bumpPresenceNodeCount(refs.get(userId) ?? {}, nodeId, -1)
    if (Object.keys(next).length === 0) {
      refs.delete(userId)
    } else {
      refs.set(userId, next)
    }
  }

  /** Clear one user's presence field (join rollback helper parity). */
  async clearWsConnectionRef(roomId: string, userId: string) {
    this.presence.get(roomId)?.delete(userId)
  }

  async clearWsPresenceRefs(roomId: string) {
    this.presence.delete(roomId)
  }

  async touchWsPresence(
    _roomId: string,
    _userId: string,
    _options?: { force?: boolean },
  ) {
    // Presence TTL is a no-op for the in-memory test store.
  }

  async readWsPresenceUserIds(roomId: string) {
    const refs = this.presence.get(roomId)
    const online = new Set<string>()
    if (!refs) return online

    const alive = new Set(this.aliveNodeIds)
    alive.add(getAppNodeId())

    for (const [uid, counts] of refs) {
      if (Object.keys(counts).length === 0) continue
      if (!this.aliveListReliable) {
        if (totalPresenceRefs(counts) > 0) online.add(uid)
        continue
      }
      if (isPresentOnAliveNode(counts, alive)) {
        online.add(uid)
      }
    }
    return online
  }

  async reconcilePresenceRefs(roomId: string) {
    if (!this.aliveListReliable) return
    const refs = this.presence.get(roomId)
    if (!refs) return

    const alive = new Set(this.aliveNodeIds)
    alive.add(getAppNodeId())

    for (const [uid, counts] of [...refs.entries()]) {
      if (Object.keys(counts).length === 0) {
        refs.delete(uid)
        continue
      }
      const liveOnly: PresenceNodeCounts = {}
      for (const [nodeId, n] of Object.entries(counts)) {
        if (n > 0 && alive.has(nodeId)) liveOnly[nodeId] = n
      }
      if (Object.keys(liveOnly).length === 0) {
        refs.delete(uid)
      } else if (
        Object.keys(liveOnly).length !== Object.keys(counts).length ||
        Object.keys(liveOnly).some((id) => liveOnly[id] !== counts[id])
      ) {
        refs.set(uid, liveOnly)
      }
    }
  }

  /** Compatibility: reconcile then return the online set. */
  async getWsPresenceUserIds(roomId: string) {
    await this.reconcilePresenceRefs(roomId)
    return this.readWsPresenceUserIds(roomId)
  }

  async seedDailyDefaultsIfEmpty() {
    if (this.dailyDefaults.length === 0) {
      this.dailyDefaults = [
        { title: "Fallback", url: "https://example.com/fallback" },
      ]
    }
  }

  /** Mutable live reference for assertions (same object held by the store). */
  peek(roomId: string) {
    return this.rooms.get(roomId)
  }
}

export function createFakeWs() {
  const sent: unknown[] = []
  let closed = false
  const ws = {
    readyState: 1,
    OPEN: 1,
    CLOSED: 3,
    send(raw: string) {
      sent.push(JSON.parse(raw))
    },
    close() {
      closed = true
      ;(ws as { readyState: number }).readyState = 3
    },
  } as unknown as WebSocket
  return {
    ws,
    sent,
    get closed() {
      return closed
    },
  }
}

export function createHandlerContext(options: {
  store: RoomStateStorePort
  roomId?: string
  userId?: string
  connectionId?: string
  controlAuthorized?: boolean
  isControlSession?: boolean
  sessionKind?: SessionKind
  ws?: WebSocket
}): RoomMessageContext {
  return {
    ws: options.ws ?? createFakeWs().ws,
    store: options.store,
    roomId: options.roomId ?? "room-1",
    userId: options.userId ?? "owner",
    connectionId: options.connectionId ?? "conn-test",
    controlAuthorized: options.controlAuthorized ?? false,
    isControlSession: options.isControlSession ?? false,
    sessionKind: options.sessionKind ?? "room",
  }
}

export function envelope(
  type: string,
  payload: Record<string, unknown> = {},
  requestId?: string,
): WsEnvelope<string, Record<string, unknown>> {
  return { type, payload, requestId }
}
