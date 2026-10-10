/**
 * Shared File/Blob byte-range reads for SFU, P2P, and HTTP provider paths.
 * Inclusive `end` (same as block-protocol / Range semantics).
 */

export async function readLocalMediaRange(
  file: Blob,
  start: number,
  end: number,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.slice(start, end + 1).arrayBuffer())
}
