/**
 * mediasoup SFU provider path: publish blocks and answer viewer requests.
 */

import {
  encodeLocalMediaBlockMetaError,
  encodeLocalMediaBlockMetaOk,
  encodeLocalMediaSfuReadyAck,
  isLocalMediaBlockRequest,
  LOCAL_MEDIA_BLOCK_CHANNEL_LABEL,
  LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH,
  LOCAL_MEDIA_MAX_BLOCK_BYTES,
  LOCAL_MEDIA_MAX_FRAME_PAYLOAD,
  parseLocalMediaBlockJson,
} from "@/lib/local-media-block-protocol"
import { getLocalMediaFile } from "@/lib/local-media-provider"
import type { types as MsTypes } from "mediasoup-client"
import {
  BUFFER_HIGH_WATER,
  call,
  getTransport,
  sessionFor,
  waitForOpen,
  type ProviderSlot,
  type Session,
  type SfuSendRequest,
} from "./local-media-sfu-session"

async function waitForDrain(producer: MsTypes.DataProducer) {
  producer.bufferedAmountLowThreshold = BUFFER_HIGH_WATER / 2
  while (producer.bufferedAmount > BUFFER_HIGH_WATER) {
    if (producer.closed) throw new Error("sfu_channel_closed")
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 50)
      producer.once("bufferedamountlow", () => {
        clearTimeout(timer)
        resolve()
      })
    })
  }
}

async function serveBlockRequest(
  producer: MsTypes.DataProducer,
  localMediaId: string,
  msg: { requestId?: string; start?: number; end?: number },
) {
  const { requestId, start, end } = msg
  const fail = (error: string) => {
    producer.send(encodeLocalMediaBlockMetaError(requestId, error))
  }

  const file = getLocalMediaFile(localMediaId)
  if (
    !file ||
    typeof requestId !== "string" ||
    requestId.length !== LOCAL_MEDIA_BLOCK_REQUEST_ID_LENGTH ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    start < 0 ||
    end < start
  ) {
    fail("provider_unavailable")
    return
  }
  if (end - start + 1 > LOCAL_MEDIA_MAX_BLOCK_BYTES) {
    fail("range_too_large")
    return
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.slice(start, end + 1).arrayBuffer())
  } catch {
    fail("read_failed")
    return
  }

  producer.send(encodeLocalMediaBlockMetaOk(requestId, bytes.byteLength))

  const header = new TextEncoder().encode(requestId)
  for (
    let offset = 0;
    offset < bytes.byteLength;
    offset += LOCAL_MEDIA_MAX_FRAME_PAYLOAD
  ) {
    await waitForDrain(producer)
    const chunk = bytes.subarray(
      offset,
      Math.min(offset + LOCAL_MEDIA_MAX_FRAME_PAYLOAD, bytes.byteLength),
    )
    const frame = new Uint8Array(header.byteLength + chunk.byteLength)
    frame.set(header, 0)
    frame.set(chunk, header.byteLength)
    producer.send(frame)
  }
}

function attachRequestConsumer(
  slot: ProviderSlot,
  localMediaId: string,
  consumer: MsTypes.DataConsumer,
) {
  consumer.binaryType = "arraybuffer"
  slot.consumers.set(consumer.dataProducerId, consumer)
  const onClosed = () => {
    if (slot.consumers.get(consumer.dataProducerId) === consumer) {
      slot.consumers.delete(consumer.dataProducerId)
    }
  }
  consumer.on("close", onClosed)
  consumer.on("transportclose", onClosed)
  consumer.on("message", (message: unknown) => {
    if (typeof message !== "string") return
    const msg = parseLocalMediaBlockJson(message)
    if (!isLocalMediaBlockRequest(msg)) return
    slot.queue = slot.queue
      .then(() => serveBlockRequest(slot.producer, localMediaId, msg))
      .catch((error) => {
        console.warn("[local-media-sfu] serve failed", error)
      })
  })
}

async function consumeRequestChannel(
  session: Session,
  slot: ProviderSlot,
  localMediaId: string,
  dataProducerId: string,
) {
  if (slot.consumers.has(dataProducerId)) return
  const recv = await getTransport(session, "recv")
  const info = await call(session, "local-media:sfu:consume-data", {
    transportId: recv.id,
    localMediaId,
    dataProducerId,
  })
  const consumer = await recv.consumeData({
    id: info.id as string,
    dataProducerId: info.dataProducerId as string,
    sctpStreamParameters:
      info.sctpStreamParameters as MsTypes.SctpStreamParameters,
    label: info.label as string | undefined,
    protocol: info.protocol as string | undefined,
  })
  attachRequestConsumer(slot, localMediaId, consumer)
  try {
    slot.producer.send(encodeLocalMediaSfuReadyAck(dataProducerId))
  } catch (error) {
    console.warn("[local-media-sfu] ready ack failed", error)
  }
}

/**
 * Provider: publish a block channel for this File and answer viewer requests
 * with slices from {@link getLocalMediaFile}.
 */
export function ensureLocalMediaSfuProvider(
  localMediaId: string,
  sendRequest: SfuSendRequest,
): Promise<boolean> {
  const session = sessionFor(sendRequest)
  if (!getLocalMediaFile(localMediaId)) return Promise.resolve(false)

  let promise = session.providers.get(localMediaId)
  if (!promise) {
    promise = (async (): Promise<ProviderSlot | null> => {
      try {
        const send = await getTransport(session, "send")
        const producer = await send.produceData({
          ordered: true,
          label: LOCAL_MEDIA_BLOCK_CHANNEL_LABEL,
          appData: { localMediaId, role: "provider" },
        })
        const slot: ProviderSlot = {
          producer,
          consumers: new Map(),
          queue: Promise.resolve(),
        }
        const onProducerClosed = () => {
          if (session.providers.get(localMediaId) === promise) {
            session.providers.delete(localMediaId)
          }
          session.requestProducers.delete(localMediaId)
          slot.consumers.clear()
        }
        producer.on("close", onProducerClosed)
        producer.on("transportclose", onProducerClosed)
        await waitForOpen(producer)

        const existing = session.requestProducers.get(localMediaId) ?? []
        await Promise.all(
          existing.map((entry) =>
            consumeRequestChannel(
              session,
              slot,
              localMediaId,
              entry.dataProducerId,
            ).catch((error) => {
              console.warn("[local-media-sfu] request consume failed", error)
            }),
          ),
        )
        return slot
      } catch (error) {
        console.warn("[local-media-sfu] provider setup failed", error)
        session.providers.delete(localMediaId)
        return null
      }
    })()
    session.providers.set(localMediaId, promise)
  }
  return promise.then((slot) => slot != null)
}

/** Provider: a viewer published a request channel for media we hold. */
export async function ensureLocalMediaSfuRequestConsumer(
  localMediaId: string,
  dataProducerId: string,
  sendRequest: SfuSendRequest,
): Promise<void> {
  const session = sessionFor(sendRequest)
  const slot = await session.providers.get(localMediaId)
  if (!slot) return
  try {
    await consumeRequestChannel(session, slot, localMediaId, dataProducerId)
  } catch (error) {
    console.warn("[local-media-sfu] request consume failed", error)
  }
}
