import type { SfuResult, SfuSendRequest } from "@/lib/local-media-sfu"
import type { WsEnvelope } from "@/zod/types"

/**
 * SFU request correlation, provide queue, and producer/result wire handlers.
 */
export function createLocalMediaSfuSession(input: {
  ws: WebSocket
  userId: string
}) {
  const { ws, userId } = input

  const sfuPending = new Map<string, (result: SfuResult) => void>()
  let sfuAvailable = false
  const pendingSfuProvide = new Set<string>()

  const sendSfuRequest: SfuSendRequest = (type, payload) =>
    new Promise<SfuResult>((resolve) => {
      if (ws.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, error: "socket_closed" })
        return
      }
      const requestId = crypto.randomUUID()
      const timer = window.setTimeout(() => {
        sfuPending.delete(requestId)
        resolve({ ok: false, error: "sfu_request_timeout" })
      }, 15_000)
      sfuPending.set(requestId, (result) => {
        window.clearTimeout(timer)
        resolve(result)
      })
      ws.send(JSON.stringify({ type, payload, requestId }))
    })

  const flushSfuPending = (error = "socket_closed") => {
    for (const [id, resolve] of sfuPending) {
      sfuPending.delete(id)
      resolve({ ok: false, error })
    }
  }

  const provideViaSfu = (localMediaId: string) => {
    if (!sfuAvailable) {
      pendingSfuProvide.add(localMediaId)
      return
    }
    void import("@/lib/local-media-sfu").then(({ ensureLocalMediaSfuProvider }) =>
      ensureLocalMediaSfuProvider(localMediaId, sendSfuRequest),
    )
  }

  const handleSfuResult = (envelope: WsEnvelope<string, unknown>) => {
    const requestId = envelope.requestId
    if (!requestId || !sfuPending.has(requestId)) return
    const resolve = sfuPending.get(requestId)
    sfuPending.delete(requestId)
    // Validate own Map entry is a function before invoke (CodeQL js/unvalidated-dynamic-method-call).
    if (typeof resolve !== "function") return
    resolve(envelope.payload as SfuResult)
  }

  const handleSfuProducer = (envelope: WsEnvelope<string, unknown>) => {
    if (!sfuAvailable) return
    const payload = envelope.payload as {
      localMediaId?: string
      dataProducerId?: string
      ownerUserId?: string
      kind?: "provider" | "requests"
    }
    const { localMediaId, dataProducerId, ownerUserId } = payload
    if (!localMediaId || !dataProducerId || !ownerUserId) return
    const isSelfOwner = ownerUserId === userId

    void (async () => {
      const sfu = await import("@/lib/local-media-sfu")
      const { getLocalMediaFile } = await import("@/lib/local-media-provider")
      const holdsFile = Boolean(getLocalMediaFile(localMediaId))
      if (payload.kind === "requests") {
        if (isSelfOwner && holdsFile) {
          await sfu.ensureLocalMediaSfuRequestConsumer(
            localMediaId,
            dataProducerId,
            sendSfuRequest,
          )
        }
        return
      }
      if (!holdsFile) {
        await sfu.ensureLocalMediaSfuViewer(localMediaId, sendSfuRequest)
      }
    })()
  }

  const markSfuAvailable = () => {
    sfuAvailable = true
  }

  const drainPendingProvides = (): Set<string> => {
    const drained = new Set(pendingSfuProvide)
    pendingSfuProvide.clear()
    return drained
  }

  const markSfuUnavailable = () => {
    sfuAvailable = false
    pendingSfuProvide.clear()
  }

  /** Process-wide SFU death / reset — fail pending requests and tear down. */
  const handleSfuUnavailable = () => {
    markSfuUnavailable()
    flushSfuPending("sfu_unavailable")
    void import("@/lib/local-media-sfu").then(({ closeLocalMediaSfu }) =>
      closeLocalMediaSfu(sendSfuRequest),
    )
  }

  return {
    sendSfuRequest,
    provideViaSfu,
    handleSfuResult,
    handleSfuProducer,
    handleSfuUnavailable,
    markSfuAvailable,
    markSfuUnavailable,
    drainPendingProvides,
    flushSfuPending,
  }
}

export type LocalMediaSfuSession = ReturnType<typeof createLocalMediaSfuSession>
