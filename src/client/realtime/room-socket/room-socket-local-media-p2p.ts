import { localMediaWebrtcSignalS2cPayloadSchema } from "@/contracts/s2c"
import type { WsEnvelope } from "@/contracts/types"
import { parseOrWarn } from "@/shared/parse-or-warn"

/**
 * P2P WebRTC signaling handler for local-media DataChannels.
 */
export function createLocalMediaWebrtcSignalHandler() {
  return (envelope: WsEnvelope<string, unknown>) => {
    const payload = parseOrWarn(
      localMediaWebrtcSignalS2cPayloadSchema,
      envelope.payload,
      "local-media:webrtc:signal",
    )
    if (!payload) return
    void import("@/client/local-media/local-media-webrtc").then(
      async ({ handleLocalMediaWebrtcSignalFromPeer }) => {
        const { getLocalMediaFile } = await import(
          "@/client/local-media/local-media-provider"
        )
        await handleLocalMediaWebrtcSignalFromPeer({
          localMediaId: payload.localMediaId,
          fromUserId: payload.fromUserId,
          signal: payload.signal,
          isProvider: Boolean(getLocalMediaFile(payload.localMediaId)),
        })
      },
    )
  }
}
