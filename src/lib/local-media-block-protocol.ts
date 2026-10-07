/**
 * Shared DataChannel control messages for local-media block delivery.
 * Used by both the P2P mesh and the mediasoup SFU path.
 *
 * Wire shape (JSON string frames):
 *   { t: "lm-block-req", requestId, start, end }
 *   { t: "lm-block-meta", requestId, ok, byteLength?, error? }
 *   { t: "lm-sfu-ready", dataProducerId }  // SFU handshake only
 */

/** Inclusive byte range size aligned with server relay blocks. */
export const LOCAL_MEDIA_MAX_BLOCK_BYTES = 256 * 1024

/** SFU binary frames prefix the UUID request id (36 ASCII chars). */
export const LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH = 36

/** Soft cap per SFU DataChannel send to stay under SCTP message limits. */
export const LOCAL_MEDIA_MAX_FRAME_PAYLOAD = 60 * 1024

export const LOCAL_MEDIA_BLOCK_REQUEST = "lm-block-req"
export const LOCAL_MEDIA_BLOCK_META = "lm-block-meta"
export const LOCAL_MEDIA_SFU_READY_ACK = "lm-sfu-ready"
export const LOCAL_MEDIA_BLOCK_CHANNEL_LABEL = "web-syncplay-local-media"

export type LocalMediaBlockRequestMessage = {
  t: typeof LOCAL_MEDIA_BLOCK_REQUEST
  requestId: string
  start: number
  end: number
}

export type LocalMediaBlockMetaMessage = {
  t: typeof LOCAL_MEDIA_BLOCK_META
  requestId?: string
  ok?: boolean
  byteLength?: number
  error?: string
}

export function encodeLocalMediaBlockRequest(
  requestId: string,
  start: number,
  end: number,
): string {
  return JSON.stringify({
    t: LOCAL_MEDIA_BLOCK_REQUEST,
    requestId,
    start,
    end,
  } satisfies LocalMediaBlockRequestMessage)
}

export function encodeLocalMediaBlockMetaOk(
  requestId: string | undefined,
  byteLength: number,
): string {
  return JSON.stringify({
    t: LOCAL_MEDIA_BLOCK_META,
    requestId,
    ok: true,
    byteLength,
  } satisfies LocalMediaBlockMetaMessage)
}

export function encodeLocalMediaBlockMetaError(
  requestId: string | undefined,
  error: string,
): string {
  return JSON.stringify({
    t: LOCAL_MEDIA_BLOCK_META,
    requestId,
    ok: false,
    error,
  } satisfies LocalMediaBlockMetaMessage)
}

export function encodeLocalMediaSfuReadyAck(dataProducerId: string): string {
  return JSON.stringify({
    t: LOCAL_MEDIA_SFU_READY_ACK,
    dataProducerId,
  })
}

export function parseLocalMediaBlockJson(
  raw: string,
): Record<string, unknown> | null {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

export function isLocalMediaBlockRequest(
  msg: Record<string, unknown> | null,
): msg is LocalMediaBlockRequestMessage {
  return (
    msg?.t === LOCAL_MEDIA_BLOCK_REQUEST &&
    typeof msg.requestId === "string" &&
    typeof msg.start === "number" &&
    typeof msg.end === "number"
  )
}

export function isLocalMediaBlockMeta(
  msg: Record<string, unknown> | null,
): msg is LocalMediaBlockMetaMessage {
  return msg?.t === LOCAL_MEDIA_BLOCK_META
}

export function parseLocalMediaSfuReadyAck(raw: string): string | null {
  const msg = parseLocalMediaBlockJson(raw)
  if (
    msg?.t !== LOCAL_MEDIA_SFU_READY_ACK ||
    typeof msg.dataProducerId !== "string"
  ) {
    return null
  }
  return msg.dataProducerId
}
