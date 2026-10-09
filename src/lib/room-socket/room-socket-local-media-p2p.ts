import type { WsEnvelope } from "@/zod/types"

/**
 * P2P WebRTC signaling handler for local-media DataChannels.
 */
export function createLocalMediaWebrtcSignalHandler() {
  return (envelope: WsEnvelope<string, unknown>) => {
    const payload = envelope.payload as {
      localMediaId?: string
      fromUserId?: string
      signal?: {
        type: "offer" | "answer" | "ice" | "hangup"
        sdp?: string
        candidate?: string
        sdpMid?: string
        sdpMLineIndex?: number
      }
    }
    if (!payload.localMediaId || !payload.fromUserId || !payload.signal) {
      return
    }
    void import("@/lib/local-media-webrtc").then(
      async ({ handleLocalMediaWebrtcSignalFromPeer }) => {
        const { getLocalMediaFile } = await import("@/lib/local-media-provider")
        await handleLocalMediaWebrtcSignalFromPeer({
          localMediaId: payload.localMediaId!,
          fromUserId: payload.fromUserId!,
          signal: payload.signal!,
          isProvider: Boolean(getLocalMediaFile(payload.localMediaId!)),
        })
      },
    )
  }
}
