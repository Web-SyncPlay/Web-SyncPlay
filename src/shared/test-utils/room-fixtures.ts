import type {
  ParticipantState,
  PlaylistItem,
  RoomState,
} from "@/contracts/types"

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
      defaultJoinRole: "guest",
      admissionVersion: 0,
    },
    playback: {
      paused: true,
      playbackRate: 1,
      timelineAnchorMs: 0,
      serverNowMs: now,
      videoLoop: "off",
      playlistLoop: "off",
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
    actionLog: [],
    updatedAt: now,
    generation: 0,
    structuralRevision: 0,
    ...overrides,
  }
}
