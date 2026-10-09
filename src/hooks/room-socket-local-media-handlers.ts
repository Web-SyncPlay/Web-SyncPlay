import type { WsEnvelope } from "@/zod/types"
import type { LocalMediaSfuSession } from "./room-socket-local-media-sfu"

/**
 * Routes local-media wire envelopes to SFU / P2P / read / reannounce handlers.
 */
export function createLocalMediaEnvelopeHandler(input: {
  sfu: LocalMediaSfuSession
  handleLocalMediaRead: (envelope: WsEnvelope<string, unknown>) => void
  handleWebrtcSignal: (envelope: WsEnvelope<string, unknown>) => void
  handleReannounce: () => void
}) {
  const { sfu, handleLocalMediaRead, handleWebrtcSignal, handleReannounce } =
    input

  return (envelope: WsEnvelope<string, unknown>): boolean => {
    switch (envelope.type) {
      case "local-media:read":
        handleLocalMediaRead(envelope)
        return true
      case "local-media:sfu:result":
        sfu.handleSfuResult(envelope)
        return true
      case "local-media:sfu:producer":
        sfu.handleSfuProducer(envelope)
        return true
      case "local-media:webrtc:signal":
        handleWebrtcSignal(envelope)
        return true
      case "local-media:reannounce":
        handleReannounce()
        return true
      default:
        return false
    }
  }
}
