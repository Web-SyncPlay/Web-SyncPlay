import type { WsEnvelope } from "@/contracts/types"
import type { z } from "zod"
import type { WebSocket } from "ws"
import { sendMutationNack, shouldNackMutation } from "./mutation-nack"
import { parseOrWarn } from "./parse-or-warn"

/**
 * Like {@link parseOrWarn}, but emits `room:error` / `invalid_payload` for
 * mutating commands when `requestId` is present.
 */
export function parseOrNack<T extends z.ZodType>(
  schema: T,
  ws: WebSocket,
  data: WsEnvelope<string, unknown>,
): z.infer<T> | null {
  const parsed = parseOrWarn(schema, data.payload, data.type)
  if (!parsed && shouldNackMutation(data.type)) {
    sendMutationNack(ws, data, "invalid_payload")
  }
  return parsed
}
