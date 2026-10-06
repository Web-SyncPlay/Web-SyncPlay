/**
 * P2P DataChannel mesh for local-media block delivery (Elevate C0).
 * Providers answer range requests; viewers request blocks over RTCDataChannel.
 * Signaling uses room WS `local-media:webrtc:signal`. HTTP remains fallback.
 */

import { getLocalMediaFile } from "@/lib/local-media-provider"
import { PUBLIC_STUN_ICE_SERVERS } from "@/lib/webrtc-ice-servers"

const BLOCK_REQUEST = "lm-block-req"
const BLOCK_META = "lm-block-meta"
const CHANNEL_LABEL = "web-syncplay-local-media"

type SignalPayload = {
  type: "offer" | "answer" | "ice" | "hangup"
  sdp?: string
  candidate?: string
  sdpMid?: string
  sdpMLineIndex?: number
}

type SendSignal = (
  targetUserId: string,
  localMediaId: string,
  signal: SignalPayload,
) => void

type PeerSlot = {
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  localMediaId: string
  remoteUserId: string
  role: "provider" | "viewer"
  pending: Map<
    string,
    {
      resolve: (bytes: Uint8Array | null) => void
      timer: ReturnType<typeof setTimeout>
    }
  >
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayLocalMediaRtc?: {
    peers: Map<string, PeerSlot>
    sendSignal: SendSignal | null
    iceServers: RTCIceServer[]
  }
}

function slot() {
  if (!g.__webSyncPlayLocalMediaRtc) {
    g.__webSyncPlayLocalMediaRtc = {
      peers: new Map(),
      sendSignal: null,
      iceServers: [...PUBLIC_STUN_ICE_SERVERS],
    }
  }
  return g.__webSyncPlayLocalMediaRtc
}

function peerKey(localMediaId: string, remoteUserId: string) {
  return `${localMediaId}:${remoteUserId}`
}

export function configureLocalMediaWebrtc(input: {
  sendSignal: SendSignal
  iceServers?: RTCIceServer[]
}) {
  const s = slot()
  s.sendSignal = input.sendSignal
  if (input.iceServers?.length) {
    s.iceServers = input.iceServers
  }
}

function wireChannel(peer: PeerSlot, channel: RTCDataChannel) {
  peer.channel = channel
  channel.binaryType = "arraybuffer"

  channel.onmessage = (event) => {
    void (async () => {
      if (typeof event.data === "string") {
        let msg: {
          t?: string
          requestId?: string
          start?: number
          end?: number
          ok?: boolean
          error?: string
        }
        try {
          msg = JSON.parse(event.data) as typeof msg
        } catch {
          return
        }
        if (msg.t === BLOCK_REQUEST && peer.role === "provider") {
          const file = getLocalMediaFile(peer.localMediaId)
          const requestId = msg.requestId
          const start = msg.start
          const end = msg.end
          if (
            !file ||
            !requestId ||
            typeof start !== "number" ||
            typeof end !== "number"
          ) {
            channel.send(
              JSON.stringify({
                t: BLOCK_META,
                requestId,
                ok: false,
                error: "provider_unavailable",
              }),
            )
            return
          }
          try {
            const buffer = await file.slice(start, end + 1).arrayBuffer()
            channel.send(
              JSON.stringify({
                t: BLOCK_META,
                requestId,
                ok: true,
                byteLength: buffer.byteLength,
              }),
            )
            channel.send(buffer)
          } catch {
            channel.send(
              JSON.stringify({
                t: BLOCK_META,
                requestId,
                ok: false,
                error: "read_failed",
              }),
            )
          }
          return
        }

        if (msg.t === BLOCK_META && peer.role === "viewer") {
          const pending = msg.requestId
            ? peer.pending.get(msg.requestId)
            : undefined
          if (!pending) return
          if (!msg.ok) {
            peer.pending.delete(msg.requestId!)
            clearTimeout(pending.timer)
            pending.resolve(null)
          }
          // ok: wait for following binary frame (stored via pending.requestId)
          ;(pending as { expectBinary?: boolean }).expectBinary = true
        }
        return
      }

      if (event.data instanceof ArrayBuffer && peer.role === "viewer") {
        // Match the oldest pending waiting for binary.
        for (const [id, pending] of peer.pending) {
          if ((pending as { expectBinary?: boolean }).expectBinary) {
            peer.pending.delete(id)
            clearTimeout(pending.timer)
            pending.resolve(new Uint8Array(event.data))
            return
          }
        }
      }
    })()
  }
}

async function ensurePeer(input: {
  localMediaId: string
  remoteUserId: string
  role: "provider" | "viewer"
  polite: boolean
}): Promise<PeerSlot | null> {
  const s = slot()
  if (!s.sendSignal) return null
  const key = peerKey(input.localMediaId, input.remoteUserId)
  const existing = s.peers.get(key)
  if (existing?.channel?.readyState === "open") {
    return existing
  }
  if (existing) {
    existing.pc.close()
    s.peers.delete(key)
  }

  const pc = new RTCPeerConnection({ iceServers: s.iceServers })
  const peer: PeerSlot = {
    pc,
    channel: null,
    localMediaId: input.localMediaId,
    remoteUserId: input.remoteUserId,
    role: input.role,
    pending: new Map(),
  }
  s.peers.set(key, peer)

  pc.onicecandidate = (event) => {
    if (!event.candidate || !s.sendSignal) return
    s.sendSignal(input.remoteUserId, input.localMediaId, {
      type: "ice",
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid ?? undefined,
      sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
    })
  }

  if (input.role === "provider") {
    const channel = pc.createDataChannel(CHANNEL_LABEL, { ordered: true })
    wireChannel(peer, channel)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    s.sendSignal(input.remoteUserId, input.localMediaId, {
      type: "offer",
      sdp: offer.sdp,
    })
  } else {
    pc.ondatachannel = (event) => {
      if (event.channel.label === CHANNEL_LABEL) {
        wireChannel(peer, event.channel)
      }
    }
  }

  void input.polite
  return peer
}

export async function handleLocalMediaWebrtcSignalFromPeer(input: {
  localMediaId: string
  fromUserId: string
  signal: SignalPayload
  /** Am I the provider for this media? */
  isProvider: boolean
}) {
  const s = slot()
  if (!s.sendSignal) return

  const key = peerKey(input.localMediaId, input.fromUserId)
  let peer = s.peers.get(key)

  if (input.signal.type === "hangup") {
    peer?.pc.close()
    s.peers.delete(key)
    return
  }

  if (input.signal.type === "offer") {
    if (!peer) {
      const created = await ensurePeer({
        localMediaId: input.localMediaId,
        remoteUserId: input.fromUserId,
        role: input.isProvider ? "provider" : "viewer",
        polite: true,
      })
      if (!created) return
      peer = created
    }
    if (!input.signal.sdp) return
    await peer.pc.setRemoteDescription({
      type: "offer",
      sdp: input.signal.sdp,
    })
    const answer = await peer.pc.createAnswer()
    await peer.pc.setLocalDescription(answer)
    s.sendSignal(input.fromUserId, input.localMediaId, {
      type: "answer",
      sdp: answer.sdp,
    })
    return
  }

  if (input.signal.type === "answer") {
    if (!peer || !input.signal.sdp) return
    await peer.pc.setRemoteDescription({
      type: "answer",
      sdp: input.signal.sdp,
    })
    return
  }

  if (input.signal.type === "ice" && input.signal.candidate) {
    if (!peer) return
    try {
      await peer.pc.addIceCandidate({
        candidate: input.signal.candidate,
        sdpMid: input.signal.sdpMid,
        sdpMLineIndex: input.signal.sdpMLineIndex,
      })
    } catch (error) {
      console.warn("[local-media-webrtc] ice failed", error)
    }
  }
}

/** Provider invites a viewer onto a DataChannel for this media id. */
export async function inviteLocalMediaWebrtcViewer(input: {
  localMediaId: string
  viewerUserId: string
}) {
  await ensurePeer({
    localMediaId: input.localMediaId,
    remoteUserId: input.viewerUserId,
    role: "provider",
    polite: false,
  })
}

export async function fetchLocalMediaRangeViaWebrtc(input: {
  localMediaId: string
  providerUserId: string
  start: number
  end: number
  timeoutMs?: number
}): Promise<Uint8Array | null> {
  const peer =
    slot().peers.get(peerKey(input.localMediaId, input.providerUserId)) ??
    (await ensurePeer({
      localMediaId: input.localMediaId,
      remoteUserId: input.providerUserId,
      role: "viewer",
      polite: true,
    }))
  if (!peer?.channel || peer.channel.readyState !== "open") {
    return null
  }

  const requestId = crypto.randomUUID()
  const timeoutMs = input.timeoutMs ?? 10_000
  const bytes = await new Promise<Uint8Array | null>((resolve) => {
    const timer = setTimeout(() => {
      peer.pending.delete(requestId)
      resolve(null)
    }, timeoutMs)
    peer.pending.set(requestId, { resolve, timer })
    peer.channel!.send(
      JSON.stringify({
        t: BLOCK_REQUEST,
        requestId,
        start: input.start,
        end: input.end,
      }),
    )
  })
  return bytes
}

export function closeLocalMediaWebrtcPeers(localMediaId?: string) {
  const s = slot()
  for (const [key, peer] of s.peers) {
    if (localMediaId && peer.localMediaId !== localMediaId) continue
    peer.pc.close()
    s.peers.delete(key)
  }
}
