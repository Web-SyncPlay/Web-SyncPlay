const ROOM_STATE_PREFIX = "room:"
const ROOM_STATE_SUFFIX = ":state"
const ROOM_CHANNEL_SUFFIX = ":channel"
const DEFAULTS_KEY = "defaults:daily-top-10"
const MEDIA_PROXY_PREFIX = "media:proxy:"
const MEDIA_PROXY_BY_URL_PREFIX = "media:proxy:by-url:"
const LOCAL_MEDIA_PREFIX = "media:local:"
const LOCAL_MEDIA_OWNER_INDEX_PREFIX = "media:local:room:"
const CONTROL_TOKEN_PREFIX = "control:token:"
const ROOM_IDENTITY_PREFIX = "room:"
const ROOM_IDENTITY_SUFFIX = ":identity"

export const keys = {
  roomState(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}${ROOM_STATE_SUFFIX}`
  },

  roomChannel(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}${ROOM_CHANNEL_SUFFIX}`
  },

  roomChannelPattern() {
    return `${ROOM_STATE_PREFIX}*${ROOM_CHANNEL_SUFFIX}`
  },

  parseRoomChannel(channel: string): string {
    const trimmed = channel.trim()
    if (!trimmed.startsWith(ROOM_STATE_PREFIX)) {
      return ""
    }
    const withoutPrefix = trimmed.slice(ROOM_STATE_PREFIX.length)
    if (!withoutPrefix.endsWith(ROOM_CHANNEL_SUFFIX)) {
      return ""
    }
    return withoutPrefix.slice(
      0,
      withoutPrefix.length - ROOM_CHANNEL_SUFFIX.length,
    )
  },

  dailyDefaults() {
    return DEFAULTS_KEY
  },

  /** HASH userId -> refcount of active WS connections cluster-wide */
  roomPresenceRef(roomId: string) {
    return `${ROOM_STATE_PREFIX}${roomId}:presenceRef`
  },

  /** HASH userId -> userSecret for participant identity continuity */
  roomIdentity(roomId: string) {
    return `${ROOM_IDENTITY_PREFIX}${roomId}${ROOM_IDENTITY_SUFFIX}`
  },

  mediaProxyToken(token: string) {
    return `${MEDIA_PROXY_PREFIX}${token}`
  },

  mediaProxyByUrl(urlHash: string) {
    return `${MEDIA_PROXY_BY_URL_PREFIX}${urlHash}`
  },

  controlToken(tokenHash: string) {
    return `${CONTROL_TOKEN_PREFIX}${tokenHash}`
  },

  localMediaEntry(id: string) {
    return `${LOCAL_MEDIA_PREFIX}${id}`
  },

  /** SET localMediaId for a given room+ownerUserId */
  localMediaOwnerIndex(roomId: string, ownerUserId: string) {
    return `${LOCAL_MEDIA_OWNER_INDEX_PREFIX}${roomId}:owner:${ownerUserId}`
  },
} as const
