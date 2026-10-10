import { getLocalMediaEntry } from "@/server/media/local-media-store"
import {
  onMediasoupWorkerDied,
} from "@/server/media/local-media-sfu-port"
import { getLocalMediaSfuPort } from "@/server/realtime/ports"
import type {
  RoomMessageContext,
  RoomMessageHandler,
} from "@/server/realtime/handlers/types"
import { getAllSockets, getSocketsForRoom } from "@/server/ws/registry"
import {
  localMediaSfuCapabilitiesSchema,
  localMediaSfuConnectTransportSchema,
  localMediaSfuConsumeDataSchema,
  localMediaSfuCreateTransportSchema,
  localMediaSfuProduceDataSchema,
} from "@/contracts/schemas"
import type { WsEnvelope } from "@/contracts/types"
import type { types as MsTypes } from "mediasoup"
import { randomUUID } from "node:crypto"
import type { WebSocket } from "ws"
import { parseOrWarn } from "./parse-or-warn"

const MAX_TRANSPORTS_PER_SOCKET = 4

const socketTransports = new WeakMap<WebSocket, Set<string>>()

type SfuResultPayload = { ok: boolean; error?: string } & Record<
  string,
  unknown
>

function reply(
  ctx: RoomMessageContext,
  data: WsEnvelope<string, Record<string, unknown>>,
  payload: SfuResultPayload,
) {
  if (ctx.ws.readyState !== ctx.ws.OPEN) return
  ctx.ws.send(
    JSON.stringify({
      type: "local-media:sfu:result",
      requestId: data.requestId,
      payload,
    }),
  )
}

function fail(
  ctx: RoomMessageContext,
  data: WsEnvelope<string, Record<string, unknown>>,
  error: unknown,
) {
  reply(ctx, data, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  })
}

function ownsTransport(
  ctx: RoomMessageContext,
  transportId: string,
  direction?: "send" | "recv",
) {
  const sfu = getLocalMediaSfuPort()
  if (!socketTransports.get(ctx.ws)?.has(transportId)) return false
  const appData = sfu.getTransportAppData(transportId)
  if (!appData || appData.roomKey !== ctx.roomId) return false
  if (direction && appData.direction !== direction) return false
  return true
}

function broadcastProducer(
  ctx: RoomMessageContext,
  payload: {
    localMediaId: string
    dataProducerId: string
    ownerUserId: string
    kind: "provider" | "requests"
  },
) {
  const envelope = JSON.stringify({
    type: "local-media:sfu:producer",
    requestId: randomUUID(),
    payload,
  })
  for (const socket of getSocketsForRoom(ctx.roomId)) {
    if (socket === ctx.ws) continue
    if (socket.readyState === socket.OPEN) {
      socket.send(envelope)
    }
  }
}

function broadcastSfuUnavailable(reason: string) {
  const envelope = JSON.stringify({
    type: "local-media:sfu:unavailable",
    requestId: randomUUID(),
    payload: { error: reason },
  })
  for (const socket of getAllSockets()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(envelope)
    }
  }
}

// Clients fall back to HTTP/P2P when the in-process worker dies.
onMediasoupWorkerDied(() => {
  broadcastSfuUnavailable("sfu_worker_died")
})

/** @internal Test helper — avoids mock.module preload races in the full suite. */
export function broadcastSfuUnavailableForTests(
  reason = "sfu_worker_died",
) {
  broadcastSfuUnavailable(reason)
}

export const handleLocalMediaSfuCapabilities: RoomMessageHandler = async (
  ctx,
  data,
) => {
  if (!parseOrWarn(localMediaSfuCapabilitiesSchema, data.payload, data.type)) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  const sfu = getLocalMediaSfuPort()
  try {
    const ready = await sfu.ensureRuntime()
    if (!ready) {
      reply(ctx, data, { ok: false, error: "sfu_unavailable" })
      return
    }
    const router = await sfu.createRouter(ctx.roomId)
    const producers = sfu
      .listProviderProducers()
      .filter((entry) => entry.roomId === ctx.roomId)
      .map((entry) => ({
        localMediaId: entry.localMediaId,
        dataProducerId: entry.dataProducerId,
        ownerUserId: entry.ownerUserId,
      }))
    reply(ctx, data, {
      ok: true,
      routerRtpCapabilities: router.rtpCapabilities,
      producers,
    })
  } catch (error) {
    fail(ctx, data, error)
  }
}

export const handleLocalMediaSfuCreateTransport: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrWarn(
    localMediaSfuCreateTransportSchema,
    data.payload,
    data.type,
  )
  if (!parsed) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  const sfu = getLocalMediaSfuPort()
  try {
    let owned = socketTransports.get(ctx.ws)
    if (!owned) {
      owned = new Set()
      socketTransports.set(ctx.ws, owned)
      ctx.ws.once("close", () => {
        for (const id of owned!) sfu.closeTransport(id)
        owned!.clear()
      })
    }
    if (owned.size >= MAX_TRANSPORTS_PER_SOCKET) {
      reply(ctx, data, { ok: false, error: "too_many_transports" })
      return
    }

    const transport = await sfu.createTransport(ctx.roomId, {
      userId: ctx.userId,
      direction: parsed.direction,
      ...(parsed.localMediaId
        ? { localMediaId: parsed.localMediaId }
        : {}),
    })
    // Close raced the await — do not leak an owned transport after disconnect.
    if (ctx.ws.readyState !== ctx.ws.OPEN) {
      sfu.closeTransport(transport.id)
      reply(ctx, data, { ok: false, error: "socket_closed" })
      return
    }
    const transportId = transport.id
    const ownedTransports = owned
    ownedTransports.add(transportId)
    sfu.onTransportClosed(transportId, () => {
      ownedTransports.delete(transportId)
    })
    reply(ctx, data, { ok: true, ...transport })
  } catch (error) {
    fail(ctx, data, error)
  }
}

export const handleLocalMediaSfuConnectTransport: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrWarn(
    localMediaSfuConnectTransportSchema,
    data.payload,
    data.type,
  )
  if (!parsed) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  if (!ownsTransport(ctx, parsed.transportId)) {
    reply(ctx, data, { ok: false, error: "transport_not_found" })
    return
  }
  const sfu = getLocalMediaSfuPort()
  try {
    await sfu.connectTransport({
      transportId: parsed.transportId,
      dtlsParameters: parsed.dtlsParameters as MsTypes.DtlsParameters,
    })
    reply(ctx, data, { ok: true })
  } catch (error) {
    fail(ctx, data, error)
  }
}

export const handleLocalMediaSfuProduceData: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrWarn(
    localMediaSfuProduceDataSchema,
    data.payload,
    data.type,
  )
  if (!parsed) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  const { transportId, localMediaId, sctpStreamParameters } = parsed
  const role = parsed.role ?? "provider"
  const sfu = getLocalMediaSfuPort()

  if (!ownsTransport(ctx, transportId, "send")) {
    reply(ctx, data, { ok: false, error: "transport_not_found" })
    return
  }

  let producerId: string | null = null
  try {
    const entry = await getLocalMediaEntry(localMediaId)
    if (!entry || entry.roomId !== ctx.roomId) {
      reply(ctx, data, { ok: false, error: "media_not_found" })
      return
    }
    if (role === "provider" && entry.ownerUserId !== ctx.userId) {
      reply(ctx, data, { ok: false, error: "not_owner" })
      return
    }

    // Provider file bytes live on the browser attached to providerNodeId's WS.
    sfu.assertProviderNodeAffinity(entry.providerNodeId)

    const produced = await sfu.produceData({
      transportId,
      sctpStreamParameters:
        sctpStreamParameters as MsTypes.SctpStreamParameters,
      label: parsed.label,
      protocol: parsed.protocol,
      appData: {
        localMediaId,
        roomId: ctx.roomId,
        ownerUserId: entry.ownerUserId,
        userId: ctx.userId,
        role,
      },
    })
    producerId = produced.id

    broadcastProducer(ctx, {
      localMediaId,
      dataProducerId: produced.id,
      ownerUserId: entry.ownerUserId,
      kind: role,
    })

    reply(ctx, data, {
      ok: true,
      id: produced.id,
      ...(role === "provider"
        ? {
            requestProducers: sfu
              .listRequestProducers(localMediaId)
              .filter((p) => p.roomId === ctx.roomId)
              .map((p) => ({ dataProducerId: p.dataProducerId })),
          }
        : {}),
    })
  } catch (error) {
    // Only tear down the failed producer — keep sibling request channels.
    if (producerId) {
      sfu.closeDataProducer(producerId)
    }
    fail(ctx, data, error)
  }
}

export const handleLocalMediaSfuConsumeData: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = parseOrWarn(
    localMediaSfuConsumeDataSchema,
    data.payload,
    data.type,
  )
  if (!parsed) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  const { transportId, localMediaId } = parsed
  const sfu = getLocalMediaSfuPort()

  if (!ownsTransport(ctx, transportId, "recv")) {
    reply(ctx, data, { ok: false, error: "transport_not_found" })
    return
  }

  try {
    const entry = await getLocalMediaEntry(localMediaId)
    if (!entry || entry.roomId !== ctx.roomId) {
      reply(ctx, data, { ok: false, error: "media_not_found" })
      return
    }
    sfu.assertProviderNodeAffinity(entry.providerNodeId)

    let dataProducerId: string
    if (parsed.dataProducerId) {
      // Request channels are only consumable by the media owner.
      const appData = sfu.getDataProducerAppData(parsed.dataProducerId)
      if (
        !appData ||
        appData.role !== "requests" ||
        appData.roomId !== ctx.roomId ||
        appData.localMediaId !== localMediaId ||
        appData.ownerUserId !== ctx.userId
      ) {
        reply(ctx, data, { ok: false, error: "producer_not_found" })
        return
      }
      dataProducerId = parsed.dataProducerId
    } else {
      const producer = sfu.getProviderProducer(localMediaId)
      if (!producer || producer.roomId !== ctx.roomId) {
        reply(ctx, data, { ok: false, error: "no_producer" })
        return
      }
      dataProducerId = producer.dataProducerId
    }

    const consumed = await sfu.consumeData({ transportId, dataProducerId })
    reply(ctx, data, { ok: true, ...consumed })
  } catch (error) {
    fail(ctx, data, error)
  }
}
