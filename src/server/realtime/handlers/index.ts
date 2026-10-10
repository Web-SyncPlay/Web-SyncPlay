import * as localMedia from "./local-media"
import * as localMediaSfu from "./local-media-sfu"
import * as participant from "./participant"
import * as playback from "./playback"
import * as playlist from "./playlist"
import * as roomSecurity from "./room-security"
import * as seekPreview from "./seek-preview"
import * as viewerMedia from "./viewer-media"
import type { ClientEventType } from "@/contracts/room-events"
import type { RoomMessageHandler } from "./types"

/**
 * Typed registry: every {@link ClientEventType} must have a handler.
 * Compile-time `satisfies` rejects missing/extra keys.
 */
export const roomMessageHandlers = {
  "playback:seek": playback.handlePlaybackSeek,
  "playback:play": playback.handlePlaybackPlay,
  "playback:pause": playback.handlePlaybackPause,
  "playback:rate": playback.handlePlaybackRate,
  "playback:loop:video": playback.handlePlaybackLoopVideo,
  "playback:loop:playlist": playback.handlePlaybackLoopPlaylist,
  "playlist:add:url": playlist.handlePlaylistAddUrl,
  "playlist:add:local": playlist.handlePlaylistAddLocal,
  "playlist:select": playlist.handlePlaylistSelect,
  "playlist:reorder": playlist.handlePlaylistReorder,
  "playlist:rename": playlist.handlePlaylistRename,
  "playlist:remove": playlist.handlePlaylistRemove,
  "playlist:retry": playlist.handlePlaylistRetry,
  "playlist:item:error": playlist.handlePlaylistItemError,
  "playlist:item:duration": playlist.handlePlaylistItemDuration,
  "local-media:chunk": localMedia.handleLocalMediaChunk,
  "local-media:ready": localMedia.handleLocalMediaReady,
  "local-media:abr:publish": localMedia.handleLocalMediaAbrPublish,
  "local-media:webrtc:signal": localMedia.handleLocalMediaWebrtcSignal,
  "local-media:sfu:capabilities": localMediaSfu.handleLocalMediaSfuCapabilities,
  "local-media:sfu:create-transport":
    localMediaSfu.handleLocalMediaSfuCreateTransport,
  "local-media:sfu:connect-transport":
    localMediaSfu.handleLocalMediaSfuConnectTransport,
  "local-media:sfu:produce-data": localMediaSfu.handleLocalMediaSfuProduceData,
  "local-media:sfu:consume-data": localMediaSfu.handleLocalMediaSfuConsumeData,
  "viewer:media:preferences": viewerMedia.handleViewerMediaPreferences,
  "seek:preview": seekPreview.handleSeekPreview,
  "participant:update": participant.handleParticipantUpdate,
  "participant:role:update": participant.handleParticipantRoleUpdate,
  "room:password:set": roomSecurity.handleRoomPasswordSet,
  "room:password:clear": roomSecurity.handleRoomPasswordClear,
  "room:default-role:set": roomSecurity.handleRoomDefaultRoleSet,
} as const satisfies Record<ClientEventType, RoomMessageHandler>
