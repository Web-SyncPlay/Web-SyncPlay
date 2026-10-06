import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"
import type { RoomStateStorePort } from "@/server/realtime/ports"
import { sanitizeRoomStateForClient } from "@/server/realtime/services/room-security"
import { getAppNodeId } from "@/server/node-id"
import { getSocketsForRoom } from "@/server/ws/registry"
import type {
  PresenceBatchPayload,
  PresencePatch,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
} from "@/zod/types"
import type { WebSocket } from "ws"
import type {
  ControlEnvelope,
  PresenceEnvelope,
  RoomBroadcastEnvelope,
  SnapshotEnvelope,
} from "./channels"

/** Identifies this process so Redis pub/sub echoes are not double-delivered. */
export const BROADCAST_NODE_ID = getAppNodeId()

const PRESENCE_BATCH_INTERVAL_MS = 250
const SNAPSHOT_COALESCE_MS = 100
const ACTION_LOG_SNAPSHOT_MAX_MS = 2000

type WiredEnvelope = RoomBroadcastEnvelope & { originNodeId?: string }

type RoomDirty = {
  presence: Map<string, PresencePatch>
  snapshot: boolean
  actionLog: boolean
  presenceTimer?: ReturnType<typeof setTimeout>
  snapshotTimer?: ReturnType<typeof setTimeout>
  actionLogTimer?: ReturnType<typeof setTimeout>
  lastStructuralHash?: string
  presenceRevision: number
}

export type BusPublishCapture = {
  roomId: string
  envelope: RoomBroadcastEnvelope
}

function structuralHash(state: RoomState): string {
  const participants = Object.fromEntries(
    Object.entries(state.participants).map(([id, p]) => [
      id,
      {
        username: p.username,
        avatarStyle: p.avatarStyle,
        role: p.role,
        connected: p.connected,
        viewerMedia: p.viewerMedia,
      },
    ]),
  )
  return JSON.stringify({
    structuralRevision: state.structuralRevision,
    ownerId: state.ownerId,
    playlist: state.playlist,
    currentIndex: state.currentIndex,
    roomSecurity: {
      joinPasswordEnabled: state.roomSecurity.joinPasswordEnabled,
      admissionVersion: state.roomSecurity.admissionVersion,
      defaultJoinRole: state.roomSecurity.defaultJoinRole,
    },
    history: state.history,
    actionLog: state.actionLog,
    participants,
  })
}

function sendRawToRoom(roomId: string, raw: string) {
  for (const client of getSocketsForRoom(roomId)) {
    if (client.readyState === client.OPEN) {
      client.send(raw)
    }
  }
}

/**
 * Coalesces presence/snapshot on the mutating node, then local fan-out + Redis PUBLISH.
 * Subscribers on other nodes fan out immediately; same-node Redis echo is ignored.
 */
export class RoomBroadcastBus {
  private rooms = new Map<string, RoomDirty>()
  private store: RoomStateStorePort | null = null
  /** When set, Redis publish is skipped (unit tests). */
  private captureOnly = false
  readonly captured: BusPublishCapture[] = []

  attachStore(store: RoomStateStorePort) {
    this.store = store
  }

  enableCaptureOnly() {
    this.captureOnly = true
  }

  clearRoom(roomId: string) {
    const dirty = this.rooms.get(roomId)
    if (!dirty) return
    if (dirty.presenceTimer) clearTimeout(dirty.presenceTimer)
    if (dirty.snapshotTimer) clearTimeout(dirty.snapshotTimer)
    if (dirty.actionLogTimer) clearTimeout(dirty.actionLogTimer)
    this.rooms.delete(roomId)
  }

  private ensure(roomId: string): RoomDirty {
    let dirty = this.rooms.get(roomId)
    if (!dirty) {
      dirty = {
        presence: new Map(),
        snapshot: false,
        actionLog: false,
        presenceRevision: 0,
      }
      this.rooms.set(roomId, dirty)
    }
    return dirty
  }

  /** Fan-out from Redis subscriber (skip if we originated the message). */
  fanOutFromPubSub(roomId: string, wired: WiredEnvelope) {
    if (wired.originNodeId && wired.originNodeId === BROADCAST_NODE_ID) {
      return
    }
    const { originNodeId: _origin, ...envelope } = wired
    sendRawToRoom(roomId, JSON.stringify(envelope as RoomBroadcastEnvelope))
  }

  fanOutLocal(roomId: string, envelope: RoomBroadcastEnvelope) {
    sendRawToRoom(roomId, JSON.stringify(envelope))
  }

  sendToSocket(ws: WebSocket, envelope: RoomBroadcastEnvelope) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(envelope))
    }
  }

  private async publishTyped(
    roomId: string,
    channel: string,
    envelope: RoomBroadcastEnvelope,
  ) {
    this.captured.push({ roomId, envelope })
    const rawLocal = JSON.stringify(envelope)
    sendRawToRoom(roomId, rawLocal)

    if (this.captureOnly) {
      return
    }

    try {
      const wired: WiredEnvelope = {
        ...envelope,
        originNodeId: BROADCAST_NODE_ID,
      }
      const client = await getCommandClient()
      await client.publish(channel, JSON.stringify(wired))
    } catch (error) {
      // Unit tests / Redis blips: local fan-out already happened.
      console.warn("[broadcast] redis publish failed", error)
    }
  }

  async publishControl(roomId: string, payload: RoomControlPayload) {
    const envelope: ControlEnvelope = { type: "room:control", payload }
    await this.publishTyped(roomId, keys.roomControlChannel(roomId), envelope)
  }

  async publishControlEphemeral(
    roomId: string,
    payload: RoomControlPayload,
  ) {
    await this.publishControl(roomId, payload)
  }

  markPresenceDirty(roomId: string, userId: string, patch: PresencePatch) {
    const dirty = this.ensure(roomId)
    const prev = dirty.presence.get(userId) ?? {}
    dirty.presence.set(userId, {
      ...prev,
      ...patch,
      localPlayback: patch.localPlayback ?? prev.localPlayback,
    })
    if (dirty.presenceTimer) return
    dirty.presenceTimer = setTimeout(() => {
      dirty.presenceTimer = undefined
      void this.flushPresence(roomId)
    }, PRESENCE_BATCH_INTERVAL_MS)
  }

  markSnapshotDirty(roomId: string) {
    const dirty = this.ensure(roomId)
    dirty.snapshot = true
    if (dirty.snapshotTimer) return
    dirty.snapshotTimer = setTimeout(() => {
      dirty.snapshotTimer = undefined
      void this.flushSnapshot(roomId)
    }, SNAPSHOT_COALESCE_MS)
  }

  markActionLogDirty(roomId: string) {
    const dirty = this.ensure(roomId)
    dirty.actionLog = true
    if (dirty.actionLogTimer) return
    dirty.actionLogTimer = setTimeout(() => {
      dirty.actionLogTimer = undefined
      if (!dirty.actionLog) return
      dirty.actionLog = false
      dirty.snapshot = true
      void this.flushSnapshot(roomId)
    }, ACTION_LOG_SNAPSHOT_MAX_MS)
  }

  async flushPresence(roomId: string) {
    const dirty = this.rooms.get(roomId)
    if (!dirty || dirty.presence.size === 0) return

    const participants: Record<string, PresencePatch> = {}
    for (const [userId, patch] of dirty.presence) {
      participants[userId] = patch
    }
    dirty.presence.clear()
    dirty.presenceRevision += 1

    const payload: PresenceBatchPayload = {
      presenceRevision: dirty.presenceRevision,
      participants,
      serverNowMs: Date.now(),
    }
    const envelope: PresenceEnvelope = { type: "presence:batch", payload }
    await this.publishTyped(roomId, keys.roomPresenceChannel(roomId), envelope)
  }

  async flushSnapshot(roomId: string) {
    const dirty = this.ensure(roomId)
    dirty.snapshot = false
    dirty.actionLog = false
    if (dirty.actionLogTimer) {
      clearTimeout(dirty.actionLogTimer)
      dirty.actionLogTimer = undefined
    }

    const payload = await this.buildSanitizedSnapshot(roomId)
    if (!payload) return

    const hash = structuralHash(payload)
    if (dirty.lastStructuralHash === hash) {
      return
    }
    dirty.lastStructuralHash = hash

    const envelope: SnapshotEnvelope = { type: "room:snapshot", payload }
    await this.publishTyped(roomId, keys.roomSnapshotChannel(roomId), envelope)
  }

  async buildSanitizedSnapshot(
    roomId: string,
  ): Promise<RoomSnapshotPayload | null> {
    const store = this.store
    if (!store || typeof store.get !== "function") return null
    const state = await store.get(roomId)
    if (!state) return null

    const overlay = await store.getPresenceDataAll(roomId)
    for (const [userId, patch] of Object.entries(overlay)) {
      const participant = state.participants[userId]
      if (!participant) continue
      if (patch.localPlayback) participant.localPlayback = patch.localPlayback
      if (typeof patch.connected === "boolean") {
        participant.connected = patch.connected
      }
      if (typeof patch.lastSeenAt === "number") {
        participant.lastSeenAt = patch.lastSeenAt
      }
      if (typeof patch.disconnectedAt === "number") {
        participant.disconnectedAt = patch.disconnectedAt
      }
      if (typeof patch.username === "string") {
        participant.username = patch.username
      }
      if (typeof patch.avatarStyle === "string") {
        participant.avatarStyle = patch.avatarStyle
      }
    }

    return sanitizeRoomStateForClient({
      ...state,
      playback: { ...state.playback, seekPreview: undefined },
    }) as RoomSnapshotPayload
  }

  controlPayloadFromState(state: RoomState): RoomControlPayload {
    return {
      generation: state.generation ?? 0,
      playback: {
        ...state.playback,
      },
      currentIndex: state.currentIndex,
      updatedAt: state.updatedAt,
    }
  }
}

let busSingleton: RoomBroadcastBus | null = null

export function getRoomBroadcastBus() {
  if (!busSingleton) {
    busSingleton = new RoomBroadcastBus()
  }
  return busSingleton
}

/** Test helper */
export function setRoomBroadcastBusForTests(bus: RoomBroadcastBus | null) {
  if (busSingleton) {
    for (const roomId of [...busSingleton["rooms"].keys()]) {
      busSingleton.clearRoom(roomId)
    }
  }
  busSingleton = bus
}

export function createTestBroadcastBus(store: RoomStateStorePort) {
  const bus = new RoomBroadcastBus()
  bus.attachStore(store)
  bus.enableCaptureOnly()
  setRoomBroadcastBusForTests(bus)
  return bus
}
