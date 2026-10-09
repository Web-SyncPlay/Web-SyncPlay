import { getLocalMediaEntry } from "@/server/media/local-media-store"
import {
  clearLocalMediaSfuProducer,
  ensureMediasoupRuntime,
  getLocalMediaSfuProducer,
  getMediasoupDataProducerAppData,
  getMediasoupTransportAppData,
  listLocalMediaSfuRequestProducers,
  listLocalMediaSfuProducers,
  mediasoupCloseTransport,
  mediasoupConnectTransport,
  mediasoupConsumeData,
  mediasoupCreateRouter,
  mediasoupCreateTransport,
  mediasoupProduceData,
  onMediasoupTransportClosed,
} from "@/server/media/mediasoup-runtime"
import type {
  RoomMessageContext,
  RoomMessageHandler,
} from "@/server/realtime/handlers/types"
import { getSocketsForRoom } from "@/server/ws/registry"
import {
  localMediaSfuCapabilitiesSchema,
  localMediaSfuConnectTransportSchema,
  localMediaSfuConsumeDataSchema,
  localMediaSfuCreateTransportSchema,
  localMediaSfuProduceDataSchema,
} from "@/zod/schemas"
import type { WsEnvelope } from "@/zod/types"
import type { types as MsTypes } from "mediasoup"
import { randomUUID } from "node:crypto"
import type { WebSocket } from "ws"

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
  if (!socketTransports.get(ctx.ws)?.has(transportId)) return false
  const appData = getMediasoupTransportAppData(transportId)
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

export const handleLocalMediaSfuCapabilities: RoomMessageHandler = async (
  ctx,
  data,
) => {
  if (!localMediaSfuCapabilitiesSchema.safeParse(data.payload).success) return
  try {
    const runtime = await ensureMediasoupRuntime()
    if (!runtime) {
      reply(ctx, data, { ok: false, error: "sfu_unavailable" })
      return
    }
    const router = await mediasoupCreateRouter(ctx.roomId)
    const producers = listLocalMediaSfuProducers()
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
  const parsed = localMediaSfuCreateTransportSchema.safeParse(data.payload)
  if (!parsed.success) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  try {
    let owned = socketTransports.get(ctx.ws)
    if (!owned) {
      owned = new Set()
      socketTransports.set(ctx.ws, owned)
      ctx.ws.once("close", () => {
        for (const id of owned!) mediasoupCloseTransport(id)
        owned!.clear()
      })
    }
    if (owned.size >= MAX_TRANSPORTS_PER_SOCKET) {
      reply(ctx, data, { ok: false, error: "too_many_transports" })
      return
    }

    const transport = await mediasoupCreateTransport(ctx.roomId, {
      userId: ctx.userId,
      direction: parsed.data.direction,
      ...(parsed.data.localMediaId
        ? { localMediaId: parsed.data.localMediaId }
        : {}),
    })
    const transportId = transport.id
    const ownedTransports = owned
    ownedTransports.add(transportId)
    onMediasoupTransportClosed(transportId, () => {
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
  const parsed = localMediaSfuConnectTransportSchema.safeParse(data.payload)
  if (!parsed.success) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  if (!ownsTransport(ctx, parsed.data.transportId)) {
    reply(ctx, data, { ok: false, error: "transport_not_found" })
    return
  }
  try {
    await mediasoupConnectTransport({
      transportId: parsed.data.transportId,
      dtlsParameters: parsed.data.dtlsParameters as MsTypes.DtlsParameters,
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
  const parsed = localMediaSfuProduceDataSchema.safeParse(data.payload)
  if (!parsed.success) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  const { transportId, localMediaId, sctpStreamParameters } = parsed.data
  const role = parsed.data.role ?? "provider"

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

    const produced = await mediasoupProduceData({
      transportId,
      sctpStreamParameters:
        sctpStreamParameters as MsTypes.SctpStreamParameters,
      label: parsed.data.label,
      protocol: parsed.data.protocol,
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
            requestProducers: listLocalMediaSfuRequestProducers(localMediaId)
              .filter((p) => p.roomId === ctx.roomId)
              .map((p) => ({ dataProducerId: p.dataProducerId })),
          }
        : {}),
    })
  } catch (error) {
    if (producerId && role === "provider") {
      clearLocalMediaSfuProducer(localMediaId)
    }
    fail(ctx, data, error)
  }
}

export const handleLocalMediaSfuConsumeData: RoomMessageHandler = async (
  ctx,
  data,
) => {
  const parsed = localMediaSfuConsumeDataSchema.safeParse(data.payload)
  if (!parsed.success) {
    reply(ctx, data, { ok: false, error: "invalid_payload" })
    return
  }
  const { transportId, localMediaId } = parsed.data

  if (!ownsTransport(ctx, transportId, "recv")) {
    reply(ctx, data, { ok: false, error: "transport_not_found" })
    return
  }

  try {
    let dataProducerId: string
    if (parsed.data.dataProducerId) {
      // Request channels are only consumable by the media owner.
      const appData = getMediasoupDataProducerAppData(parsed.data.dataProducerId)
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
      dataProducerId = parsed.data.dataProducerId
    } else {
      const producer = getLocalMediaSfuProducer(localMediaId)
      if (!producer || producer.roomId !== ctx.roomId) {
        reply(ctx, data, { ok: false, error: "no_producer" })
        return
      }
      dataProducerId = producer.dataProducerId
    }

    const consumed = await mediasoupConsumeData({ transportId, dataProducerId })
    reply(ctx, data, { ok: true, ...consumed })
  } catch (error) {
    fail(ctx, data, error)
  }
}
