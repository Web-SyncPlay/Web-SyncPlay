/**
 * Public STUN-only ICE servers for local-media WebRTC (P2P + mediasoup).
 * No TURN — clients that cannot send UDP to peers/SFU fall back to HTTP relay
 * or cannot use the WebRTC path.
 */
export const PUBLIC_STUN_ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
    ],
  },
  {
    urls: ["stun:stun.cloudflare.com:3478"],
  },
]
