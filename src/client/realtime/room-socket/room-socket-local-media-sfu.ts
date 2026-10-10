import type { SfuResult, SfuSendRequest } from "@/client/local-media/local-media-sfu"
import {
  decideSfuProducerWireAction,
  isSfuSessionGenerationCurrent,
  nextSfuSessionGeneration,
  planSfuProvideAttempt,
} from "@/client/local-media/local-media-sfu-transitions"
import {
  localMediaSfuProducerPayloadSchema,
  localMediaSfuResultPayloadSchema,
} from "@/contracts/s2c"
import type { WsEnvelope } from "@/contracts/types"
import { parseOrWarn } from "@/shared/parse-or-warn"

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
  let sessionGeneration = 0
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
    if (planSfuProvideAttempt(sfuAvailable) === "queue") {
      pendingSfuProvide.add(localMediaId)
      return
    }
    void import("@/client/local-media/local-media-sfu").then(({ ensureLocalMediaSfuProvider }) =>
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
    const payload = parseOrWarn(
      localMediaSfuResultPayloadSchema,
      envelope.payload,
      "local-media:sfu:result",
    )
    if (!payload) {
      resolve({ ok: false, error: "invalid_payload" })
      return
    }
    resolve(payload as SfuResult)
  }

  const handleSfuProducer = (envelope: WsEnvelope<string, unknown>) => {
    const payload = parseOrWarn(
      localMediaSfuProducerPayloadSchema,
      envelope.payload,
      "local-media:sfu:producer",
    )
    if (!payload) return
    const { localMediaId, dataProducerId, ownerUserId } = payload
    const isSelfOwner = ownerUserId === userId
    const workGeneration = sessionGeneration

    void (async () => {
      const sfu = await import("@/client/local-media/local-media-sfu")
      const { getLocalMediaFile } = await import("@/client/local-media/local-media-provider")
      if (!isSfuSessionGenerationCurrent(sessionGeneration, workGeneration)) {
        return
      }
      const holdsFile = Boolean(getLocalMediaFile(localMediaId))
      const action = decideSfuProducerWireAction({
        sfuAvailable,
        kind: payload.kind,
        isSelfOwner,
        holdsLocalFile: holdsFile,
      })
      if (action === "consume-requests") {
        await sfu.ensureLocalMediaSfuRequestConsumer(
          localMediaId,
          dataProducerId,
          sendSfuRequest,
        )
        return
      }
      if (action === "ensure-viewer") {
        await sfu.ensureLocalMediaSfuViewer(localMediaId, sendSfuRequest)
      }
    })()
  }

  const markSfuAvailable = () => {
    sfuAvailable = true
  }

  const getSfuAvailable = () => sfuAvailable

  const drainPendingProvides = (): Set<string> => {
    const drained = new Set(pendingSfuProvide)
    pendingSfuProvide.clear()
    return drained
  }

  const markSfuUnavailable = () => {
    sfuAvailable = false
    pendingSfuProvide.clear()
    sessionGeneration = nextSfuSessionGeneration(sessionGeneration)
  }

  /** Process-wide SFU death / reset — fail pending requests and tear down. */
  const handleSfuUnavailable = () => {
    markSfuUnavailable()
    flushSfuPending("sfu_unavailable")
    void import("@/client/local-media/local-media-sfu").then(({ closeLocalMediaSfu }) =>
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
    getSfuAvailable,
    drainPendingProvides,
    flushSfuPending,
  }
}

export type LocalMediaSfuSession = ReturnType<typeof createLocalMediaSfuSession>
