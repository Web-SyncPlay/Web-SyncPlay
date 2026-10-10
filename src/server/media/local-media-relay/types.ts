import { LOCAL_MEDIA_MAX_BLOCK_BYTES } from "@/shared/local-media/local-media-block-protocol"
import type { LocalMediaErrorCode } from "@/shared/local-media/local-media-errors"

/** Aligned provider blocks; must match client DataChannel max block size. */
export const LOCAL_MEDIA_RELAY_CHUNK_BYTES = LOCAL_MEDIA_MAX_BLOCK_BYTES
export const LOCAL_MEDIA_RELAY_TIMEOUT_MS = 15_000

export type LocalMediaReadRequest = {
  requestId: string
  localMediaId: string
  start: number
  end: number
}

export type LocalMediaChunkPayload = {
  requestId: string
  ok: boolean
  /** Raw chunk bytes from binary LMC frames (preferred; avoids base64). */
  data?: Uint8Array
  /** Legacy JSON path / Redis serialization. */
  dataBase64?: string
  error?: string
}

export class LocalMediaRelayError extends Error {
  readonly code: LocalMediaErrorCode

  constructor(code: LocalMediaErrorCode, message?: string) {
    super(message ?? code)
    this.name = "LocalMediaRelayError"
    this.code = code
  }
}

export type PendingLocal = {
  resolve: (payload: LocalMediaChunkPayload) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type RelayPubSubRequest = {
  requestId: string
  roomId: string
  ownerUserId: string
  localMediaId: string
  start: number
  end: number
  originNodeId: string
}
