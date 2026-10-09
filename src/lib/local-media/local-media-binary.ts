/**
 * Binary WebSocket frame for local-media chunk replies (client → server).
 *
 * Layout (little-endian):
 *   magic u32          0x4c4d4301  ("LMC\x01" as BE mnemonic)
 *   requestIdLength u16
 *   requestId utf8
 *   flags u8           bit0 = ok
 *   body               raw media bytes if ok; else utf8 error string
 */

export const LMC_MAGIC = 0x4c4d4301
export const LMC_FLAG_OK = 0x01

export type LocalMediaBinaryChunk = {
  requestId: string
  ok: boolean
  data?: Uint8Array
  error?: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function encodeLocalMediaChunkFrame(
  chunk: LocalMediaBinaryChunk,
): Uint8Array {
  const requestIdBytes = textEncoder.encode(chunk.requestId)
  if (requestIdBytes.byteLength > 0xffff) {
    throw new RangeError("requestId exceeds u16 length")
  }

  const body = chunk.ok
    ? (chunk.data ?? new Uint8Array(0))
    : textEncoder.encode(chunk.error ?? "")

  const headerLen = 4 + 2 + requestIdBytes.byteLength + 1
  const out = new Uint8Array(headerLen + body.byteLength)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint32(0, LMC_MAGIC, true)
  view.setUint16(4, requestIdBytes.byteLength, true)
  out.set(requestIdBytes, 6)
  out[6 + requestIdBytes.byteLength] = chunk.ok ? LMC_FLAG_OK : 0
  out.set(body, headerLen)
  return out
}

/**
 * Decode an LMC frame. Returns null when the buffer is too short or the magic
 * does not match (so callers can fall through to JSON).
 */
export function decodeLocalMediaChunkFrame(
  input: Uint8Array | ArrayBuffer,
): LocalMediaBinaryChunk | null {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < 7) {
    return null
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== LMC_MAGIC) {
    return null
  }

  const requestIdLength = view.getUint16(4, true)
  const headerLen = 4 + 2 + requestIdLength + 1
  if (bytes.byteLength < headerLen) {
    return null
  }

  const requestId = textDecoder.decode(
    bytes.subarray(6, 6 + requestIdLength),
  )
  const flags = bytes[6 + requestIdLength]!
  const rest = bytes.subarray(headerLen)
  const ok = (flags & LMC_FLAG_OK) !== 0

  if (ok) {
    return { requestId, ok: true, data: rest.slice() }
  }

  return {
    requestId,
    ok: false,
    error: textDecoder.decode(rest),
  }
}

/** True when the buffer starts with the LMC magic (cheap peek). */
export function isLocalMediaChunkFrame(
  input: Uint8Array | ArrayBuffer,
): boolean {
  const bytes =
    input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.byteLength < 4) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(0, true) === LMC_MAGIC
}
