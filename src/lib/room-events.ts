import type { LoopMode, RoomRole, SessionKind } from "@/zod/types"

export interface ClientEventPayloadMap {
  "participant:update": {
    username?: string
    avatarStyle?: string
    paused?: boolean
    currentTimeMs?: number
    loading?: boolean
    error?: string
  }
  "participant:role:update": {
    targetUserId: string
    role: Exclude<RoomRole, "owner">
  }
  "playback:play": { currentTimeMs?: number }
  "playback:pause": { currentTimeMs?: number }
  "playback:seek": { targetMs: number }
  "playback:rate": { playbackRate: number }
  "playback:loop:video": { mode: LoopMode }
  "playback:loop:playlist": { mode: LoopMode }
  "playlist:add:url": { url: string }
  "playlist:add:local": {
    localMediaId: string
    name: string
    mimeType: string
    sizeBytes: number
  }
  "local-media:chunk": {
    requestId: string
    ok: boolean
    dataBase64?: string
    error?: string
  }
  "local-media:ready": {
    localMediaId: string
    ready: boolean
  }
  "playlist:retry": { itemId: string }
  "playlist:item:error": { itemId: string; error: string }
  "viewer:media:preferences": {
    itemId: string
    streamId?: string | null
    textTrackId?: string | null
    audioLanguage?: string
  }
  "playlist:rename": { itemId: string; name: string }
  "playlist:reorder": { from: number; to: number }
  "playlist:select": { index: number }
  "seek:preview": { targetMs?: number; active?: boolean }
  "room:password:set": { password: string }
  "room:password:clear": Record<string, never>
}

export type ClientEventType = keyof ClientEventPayloadMap

export type TypedRoomEventSender = <T extends ClientEventType>(
  type: T,
  payload: ClientEventPayloadMap[T],
) => void

export type { SessionKind }
