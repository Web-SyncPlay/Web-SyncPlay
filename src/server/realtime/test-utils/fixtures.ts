import type { RoomStateStorePort } from "@/server/realtime/ports"
import type {
  ParticipantState,
  PlaylistItem,
  RoomState,
  SessionKind,
  WsEnvelope,
} from "@/zod/types"
import type { WebSocket } from "ws"
import type { RoomMessageContext } from "../handlers/types"

export function createParticipant(
  overrides: Partial<ParticipantState> & Pick<ParticipantState, "userId">,
): ParticipantState {
  const now = Date.now()
  return {
    username: overrides.username ?? overrides.userId,
    avatarStyle: overrides.avatarStyle ?? "adventurer",
    role: overrides.role ?? "guest",
    connected: overrides.connected ?? true,
    joinedAt: overrides.joinedAt ?? now,
    connectedAt: overrides.connectedAt ?? now,
    lastSeenAt: overrides.lastSeenAt ?? now,
    localPlayback: overrides.localPlayback ?? {
      paused: true,
      currentTimeMs: 0,
      loading: false,
      updatedAt: now,
    },
    ...overrides,
  }
}

export function createPlaylistItem(
  overrides: Partial<PlaylistItem> & Pick<PlaylistItem, "id" | "name">,
): PlaylistItem {
  return {
    sourceKind: "remote_url",
    playbackMode: "direct",
    sourceUrl: overrides.sourceUrl ?? `https://example.com/${overrides.id}`,
    playableUrl: overrides.playableUrl ?? `https://example.com/${overrides.id}`,
    ingestStatus: "ready",
    createdBy: overrides.createdBy ?? "owner",
    createdAt: overrides.createdAt ?? Date.now(),
    ...overrides,
  }
}

export function createRoomState(overrides: Partial<RoomState> = {}): RoomState {
  const now = Date.now()
  const owner = createParticipant({
    userId: "owner",
    username: "Owner",
    role: "owner",
  })
  const guest = createParticipant({
    userId: "guest",
    username: "Guest",
    role: "guest",
  })
  const moderator = createParticipant({
    userId: "mod",
    username: "Mod",
    role: "moderator",
  })

  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 0,
    },
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: now,
      videoLoop: "off",
      playlistLoop: "off",
      shuffle: false,
    },
    playlist: [
      createPlaylistItem({ id: "item-a", name: "A" }),
      createPlaylistItem({ id: "item-b", name: "B" }),
      createPlaylistItem({
        id: "item-c",
        name: "C",
        mediaStreams: [
          { id: "stream-1", src: "https://example.com/c.m3u8", isDefault: true },
        ],
        textTracks: [
          { id: "track-1", src: "https://example.com/c.vtt", label: "EN" },
        ],
        defaultStreamId: "stream-1",
        defaultTextTrackId: "track-1",
      }),
    ],
    currentIndex: 0,
    participants: {
      owner,
      guest,
      mod: moderator,
    },
    history: [],
    actionLog: [],
    updatedAt: now,
    ...overrides,
  }
}

export class InMemoryRoomStateStore implements RoomStateStorePort {
  rooms = new Map<string, RoomState>()
  presence = new Map<string, Set<string>>()
  dailyDefaults: Array<{ title: string; url: string }> = []

  constructor(initial?: RoomState) {
    if (initial) {
      this.rooms.set(initial.roomId, structuredClone(initial))
      this.presence.set(
        initial.roomId,
        new Set(
          Object.values(initial.participants)
            .filter((p) => p.connected)
            .map((p) => p.userId),
        ),
      )
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
    const set = this.presence.get(roomId) ?? new Set()
    set.add(userId)
    this.presence.set(roomId, set)
  }

  async removeWsConnectionRef(roomId: string, userId: string) {
    this.presence.get(roomId)?.delete(userId)
  }

  async touchWsPresence(_roomId: string, _userId: string) {}

  async getWsPresenceUserIds(roomId: string) {
    return new Set(this.presence.get(roomId) ?? [])
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
  const ws = {
    readyState: 1,
    OPEN: 1,
    send(raw: string) {
      sent.push(JSON.parse(raw))
    },
  } as unknown as WebSocket
  return { ws, sent }
}

export function createHandlerContext(options: {
  store: RoomStateStorePort
  roomId?: string
  userId?: string
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
