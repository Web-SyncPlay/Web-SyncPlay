import type { WsEnvelope } from "@/zod/types"

/**
 * HTTP-relay client path: answer peer range reads from this tab's File.
 */
export function createLocalMediaReadHandler(ws: WebSocket) {
  return (envelope: WsEnvelope<string, unknown>) => {
    const payload = envelope.payload as {
      requestId?: string
      localMediaId?: string
      start?: number
      end?: number
    }
    const requestId = payload.requestId
    const localMediaId = payload.localMediaId
    const start = payload.start
    const end = payload.end
    if (
      !requestId ||
      !localMediaId ||
      typeof start !== "number" ||
      typeof end !== "number"
    ) {
      return
    }

    void (async () => {
      const { getLocalMediaFile } = await import("@/lib/local-media-provider")
      const { encodeLocalMediaChunkFrame } = await import(
        "@/lib/local-media-binary"
      )
      const file = getLocalMediaFile(localMediaId)
      // Stay silent when this tab does not hold the File so another
      // session for the same user can still answer the range request.
      if (!file) {
        return
      }
      try {
        const slice = file.slice(start, end + 1)
        const buffer = await slice.arrayBuffer()
        // Binary LMC frame avoids ~33% base64 overhead on the wire.
        const frame = encodeLocalMediaChunkFrame({
          requestId,
          ok: true,
          data: new Uint8Array(buffer),
        })
        // Fresh ArrayBuffer-backed view satisfies DOM WebSocket BufferSource typings.
        const wire = new Uint8Array(frame.byteLength)
        wire.set(frame)
        ws.send(wire)
      } catch (error) {
        console.error("[local-media] failed to read range", {
          localMediaId,
          requestId,
          start,
          end,
          error,
        })
        // Keep JSON error path for simplicity / older server compat.
        ws.send(
          JSON.stringify({
            type: "local-media:chunk",
            requestId: crypto.randomUUID(),
            payload: {
              requestId,
              ok: false,
              error: "read_failed",
            },
          }),
        )
      }
    })()
  }
}
