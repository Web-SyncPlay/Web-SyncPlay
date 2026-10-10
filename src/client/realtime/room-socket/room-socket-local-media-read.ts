import type { WsEnvelope } from "@/contracts/types"
import type { LocalMediaRuntime } from "@/client/local-media/local-media-runtime"

/**
 * HTTP-relay client path: answer peer range reads from this tab's File.
 */
export function createLocalMediaReadHandler(
  ws: WebSocket,
  runtime?: LocalMediaRuntime,
) {
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
      const { getLocalMediaFile } = await import(
        "@/client/local-media/local-media-provider"
      )
      const { encodeLocalMediaChunkFrame } = await import(
        "@/shared/local-media/local-media-binary"
      )
      const { resolveRangeResponder } = await import(
        "@/client/local-media/local-media-range-responder"
      )

      // Stay silent when this tab does not hold the File so another
      // session for the same user can still answer the range request.
      if (!getLocalMediaFile(localMediaId)) {
        return
      }

      const responder = runtime?.rangeResponder ?? resolveRangeResponder(getLocalMediaFile)
      const result = await responder.serve({
        localMediaId,
        start,
        end,
        requestId,
      })
      if (!result.ok) {
        if (result.error === "provider_unavailable") {
          return
        }
        console.error("[local-media] failed to read range", {
          localMediaId,
          requestId,
          start,
          end,
          error: result.error,
        })
        ws.send(
          JSON.stringify({
            type: "local-media:chunk",
            requestId: crypto.randomUUID(),
            payload: {
              requestId,
              ok: false,
              error: result.error === "read_failed" ? "read_failed" : result.error,
            },
          }),
        )
        return
      }

      const frame = encodeLocalMediaChunkFrame({
        requestId,
        ok: true,
        data: result.bytes,
      })
      // Fresh ArrayBuffer-backed view satisfies DOM WebSocket BufferSource typings.
      const wire = new Uint8Array(frame.byteLength)
      wire.set(frame)
      ws.send(wire)
    })()
  }
}
