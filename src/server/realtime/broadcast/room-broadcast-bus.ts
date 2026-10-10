import {
  setRoomPublishPort,
  type RoomStateStorePort,
} from "@/server/realtime/ports"
import type {
  AdmissionChangedPayload,
  PresencePatch,
  RoomControlPayload,
  RoomSnapshotPayload,
  RoomState,
} from "@/contracts/types"
import type { WebSocket } from "ws"
import type { RoomBroadcastEnvelope } from "./channels"
import {
  fanOutFromPubSub as fanOutFromPubSubImpl,
  fanOutUserEphemeral as fanOutUserEphemeralImpl,
  sendToSocket as sendToSocketImpl,
} from "./bus-fanout"
import {
  publishAdmissionChangedEnvelope,
  publishControlEnvelope,
  publishUserEphemeralEnvelope,
  type PublishCapture,
} from "./control-publisher"
import { BROADCAST_NODE_ID } from "./node-id"
import {
  clearPresenceSeqFallback,
  resetPresenceSeqFallbackForTests,
} from "./presence-seq"
import {
  flushPresenceBatch,
  mergePresenceDirty,
} from "./presence-publisher"
import { buildSanitizedSnapshot } from "./snapshot-build"
import { flushSnapshotPublish } from "./snapshot-publisher"

export { BROADCAST_NODE_ID }
export { resetPresenceSeqFallbackForTests }

const PRESENCE_BATCH_INTERVAL_MS = 250
const SNAPSHOT_COALESCE_MS = 100
const ACTION_LOG_SNAPSHOT_MAX_MS = 2000

type DirtyTimerKey = "presenceTimer" | "snapshotTimer" | "actionLogTimer"

type RoomDirty = {
  presence: Map<string, PresencePatch>
  snapshot: boolean
  actionLog: boolean
  presenceTimer?: ReturnType<typeof setTimeout>
  snapshotTimer?: ReturnType<typeof setTimeout>
  actionLogTimer?: ReturnType<typeof setTimeout>
  lastStructuralHash?: string
}

export type BusPublishCapture = PublishCapture

type BusSlot = {
  bus: RoomBroadcastBus | null
}

function getBusSlot(): BusSlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayBroadcastBus?: BusSlot
  }
  g.__webSyncPlayBroadcastBus ??= { bus: null }
  return g.__webSyncPlayBroadcastBus
}

/**
 * Coalesces presence/snapshot on the mutating node, then local fan-out + Redis PUBLISH.
 * Subscribers on other nodes fan out immediately; same-node Redis echo is ignored.
 *
 * Publishers: control (`control-publisher`), presence (`presence-publisher`),
 * snapshot (`snapshot-publisher`). Fan-out helpers live in `bus-fanout`.
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
    this.clearTimers(dirty)
    this.rooms.delete(roomId)
    clearPresenceSeqFallback(roomId)
  }

  clearAllRooms() {
    for (const roomId of [...this.rooms.keys()]) {
      this.clearRoom(roomId)
    }
  }

  private clearTimers(dirty: RoomDirty) {
    if (dirty.presenceTimer) clearTimeout(dirty.presenceTimer)
    if (dirty.snapshotTimer) clearTimeout(dirty.snapshotTimer)
    if (dirty.actionLogTimer) clearTimeout(dirty.actionLogTimer)
    dirty.presenceTimer = undefined
    dirty.snapshotTimer = undefined
    dirty.actionLogTimer = undefined
  }

  private ensure(roomId: string): RoomDirty {
    let dirty = this.rooms.get(roomId)
    if (!dirty) {
      dirty = {
        presence: new Map(),
        snapshot: false,
        actionLog: false,
      }
      this.rooms.set(roomId, dirty)
    }
    return dirty
  }

  private scheduleOnce(
    dirty: RoomDirty,
    timerKey: DirtyTimerKey,
    delayMs: number,
    run: () => void,
  ) {
    if (dirty[timerKey]) return
    dirty[timerKey] = setTimeout(() => {
      dirty[timerKey] = undefined
      run()
    }, delayMs)
  }

  /** Fan-out from Redis subscriber (skip if we originated the message). */
  fanOutFromPubSub(
    roomId: string,
    wired: RoomBroadcastEnvelope & { originNodeId?: string },
  ) {
    fanOutFromPubSubImpl(roomId, wired)
  }

  sendToSocket(ws: WebSocket, envelope: RoomBroadcastEnvelope) {
    sendToSocketImpl(ws, envelope)
  }

  async publishControl(roomId: string, payload: RoomControlPayload) {
    await publishControlEnvelope({
      roomId,
      payload,
      captureOnly: this.captureOnly,
      captured: this.captured,
    })
  }

  /** Same wire path as publishControl; named for seek-preview / non-persisted control. */
  async publishControlEphemeral(
    roomId: string,
    payload: RoomControlPayload,
  ) {
    await this.publishControl(roomId, payload)
  }

  /**
   * Deliver a user-targeted ephemeral WS envelope (local sockets + Redis).
   * Used for cross-replica WebRTC signaling.
   */
  async publishUserEphemeral(
    roomId: string,
    targetUserId: string,
    envelope: { type: string; requestId?: string; payload: unknown },
  ) {
    await publishUserEphemeralEnvelope({
      roomId,
      targetUserId,
      envelope,
      captureOnly: this.captureOnly,
      fanOutLocal: fanOutUserEphemeralImpl,
    })
  }

  /** Local delivery for user-targeted ephemerals (also used by Redis subscriber). */
  fanOutUserEphemeral(
    roomId: string,
    targetUserId: string,
    envelope: { type: string; requestId?: string; payload: unknown },
  ) {
    fanOutUserEphemeralImpl(roomId, targetUserId, envelope)
  }

  /**
   * Force non-owners to re-admit after join-password / admissionVersion bump.
   * Local registry + Redis control channel (other replicas apply the same kick).
   */
  async publishAdmissionChanged(
    roomId: string,
    payload: AdmissionChangedPayload,
  ) {
    await publishAdmissionChangedEnvelope({
      roomId,
      payload,
      captureOnly: this.captureOnly,
      captured: this.captured,
    })
  }

  markPresenceDirty(roomId: string, userId: string, patch: PresencePatch) {
    const dirty = this.ensure(roomId)
    mergePresenceDirty(dirty.presence, userId, patch)
    this.scheduleOnce(dirty, "presenceTimer", PRESENCE_BATCH_INTERVAL_MS, () => {
      void this.flushPresence(roomId)
    })
  }

  markSnapshotDirty(roomId: string) {
    const dirty = this.ensure(roomId)
    dirty.snapshot = true
    this.scheduleOnce(dirty, "snapshotTimer", SNAPSHOT_COALESCE_MS, () => {
      void this.flushSnapshot(roomId)
    })
  }

  markActionLogDirty(roomId: string) {
    const dirty = this.ensure(roomId)
    dirty.actionLog = true
    this.scheduleOnce(
      dirty,
      "actionLogTimer",
      ACTION_LOG_SNAPSHOT_MAX_MS,
      () => {
        if (!dirty.actionLog) return
        dirty.actionLog = false
        dirty.snapshot = true
        void this.flushSnapshot(roomId)
      },
    )
  }

  async flushPresence(roomId: string) {
    const dirty = this.rooms.get(roomId)
    if (!dirty || dirty.presence.size === 0) return

    const participants: Record<string, PresencePatch> = {}
    for (const [userId, patch] of dirty.presence) {
      participants[userId] = patch
    }
    dirty.presence.clear()

    await flushPresenceBatch({
      roomId,
      participants,
      captureOnly: this.captureOnly,
      captured: this.captured,
    })
  }

  async flushSnapshot(roomId: string) {
    const dirty = this.ensure(roomId)
    dirty.snapshot = false
    dirty.actionLog = false
    if (dirty.actionLogTimer) {
      clearTimeout(dirty.actionLogTimer)
      dirty.actionLogTimer = undefined
    }

    dirty.lastStructuralHash = await flushSnapshotPublish({
      roomId,
      store: this.store,
      lastStructuralHash: dirty.lastStructuralHash,
      captureOnly: this.captureOnly,
      captured: this.captured,
    })
  }

  async buildSanitizedSnapshot(
    roomId: string,
  ): Promise<RoomSnapshotPayload | null> {
    return buildSanitizedSnapshot(this.store, roomId)
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

export function getRoomBroadcastBus() {
  const slot = getBusSlot()
  slot.bus ??= new RoomBroadcastBus()
  return slot.bus
}

/** Test helper */
export function setRoomBroadcastBusForTests(bus: RoomBroadcastBus | null) {
  const slot = getBusSlot()
  slot.bus?.clearAllRooms()
  slot.bus = bus
  setRoomPublishPort(bus)
}

export function createTestBroadcastBus(store: RoomStateStorePort) {
  const bus = new RoomBroadcastBus()
  bus.attachStore(store)
  bus.enableCaptureOnly()
  setRoomBroadcastBusForTests(bus)
  return bus
}
