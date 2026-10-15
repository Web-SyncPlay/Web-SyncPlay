/**
 * Shared “share local file into playlist” path used by playlist controls
 * and the landing → room handoff.
 */

import { persistLocalMediaHandle } from "@/client/local-media/local-media-handles"
import { registerLocalMediaFile } from "@/client/local-media/local-media-provider"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import { resolvePlayableMimeType } from "@/shared/media-mime"

export type ShareLocalMediaResult =
  { ok: true; localMediaId: string } | { ok: false; error: string }

export async function shareLocalMediaFile(input: {
  file: File
  handle?: FileSystemFileHandle
  roomId: string
  userId: string
  send: TypedRoomEventSender
}): Promise<ShareLocalMediaResult> {
  const { file, handle, roomId, userId, send } = input

  const mimeType = resolvePlayableMimeType(file.type, file.name)
  if (!mimeType) {
    return { ok: false, error: "Only video or audio files can be shared" }
  }
  if (file.size <= 0) {
    return { ok: false, error: "File is empty" }
  }

  const localMediaId = crypto.randomUUID()
  // Keep the File in-tab — no upload. Viewers pull byte ranges via the server relay.
  registerLocalMediaFile(localMediaId, file, mimeType)
  if (handle) {
    await persistLocalMediaHandle({
      localMediaId,
      roomId,
      userId,
      filename: file.name || "Local media",
      mimeType,
      sizeBytes: file.size,
      handle,
    })
  }
  const { probeLocalMediaDurationSec, runLocalMediaAbrPublish } =
    await import("@/client/local-media/local-media-abr")
  const durationSeconds = await probeLocalMediaDurationSec(file)
  send("playlist:add:local", {
    localMediaId,
    name: file.name || "Local media",
    mimeType,
    sizeBytes: file.size,
    ...(durationSeconds !== null
      ? { durationSeconds: Math.round(durationSeconds) }
      : {}),
  })
  send("local-media:ready", { localMediaId, ready: true })
  void runLocalMediaAbrPublish({
    parentLocalMediaId: localMediaId,
    file,
    mimeType,
    name: file.name || "Local media",
    send,
  })
  return { ok: true, localMediaId }
}
