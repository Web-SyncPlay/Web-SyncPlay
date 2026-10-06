import { env } from "@/env"
import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"
import { createClient, type RedisClientType } from "redis"

type RedisSlot = {
  command?: RedisClientType
  subscriber?: RedisClientType
}

const slot = (() => {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayRedis?: RedisSlot
  }
  g.__webSyncPlayRedis ??= {}
  return g.__webSyncPlayRedis
})()

let shutdownRegistered = false

/**
 * Cap reconnect attempts so `await connect()` cannot hang forever when Valkey
 * is down (node-redis defaults to unlimited retries). Callers that treat Redis
 * as optional (e.g. local-media block cache) rely on this rejecting quickly;
 * the next `getCommandClient()` creates a fresh client and tries again.
 */
const REDIS_MAX_RECONNECT_ATTEMPTS = 3

function redisSocketOptions() {
  return {
    connectTimeout: 1_000,
    reconnectStrategy(retries: number) {
      if (retries >= REDIS_MAX_RECONNECT_ATTEMPTS) {
        return new Error(
          `Redis connection failed after ${REDIS_MAX_RECONNECT_ATTEMPTS} attempts`,
        )
      }
      return Math.min(50 * 2 ** retries, 200)
    },
  }
}

function ensureShutdownRegistered() {
  if (shutdownRegistered) return
  shutdownRegistered = true
  installShutdownOnce()
  registerShutdownHandler(shutdownRedis)
}

async function connectOrReset(
  kind: "command" | "subscriber",
  factory: () => RedisClientType,
): Promise<RedisClientType> {
  ensureShutdownRegistered()
  const existing = slot[kind]
  if (existing?.isOpen) {
    return existing
  }

  if (!slot[kind]) {
    const client = factory()
    // node-redis emits `error` during reconnect; without a listener the process
    // can crash on ECONNREFUSED while connect() is still retrying.
    client.on("error", () => {
      // intentional no-op: callers handle connect()/command failures via await
    })
    slot[kind] = client
  }
  const client = slot[kind]!
  if (client.isOpen) {
    return client
  }

  try {
    await client.connect()
    return client
  } catch (error) {
    slot[kind] = undefined
    try {
      client.removeAllListeners()
      await client.disconnect()
    } catch {
      // ignore cleanup errors after a failed connect
    }
    throw error
  }
}

export async function getCommandClient(): Promise<RedisClientType> {
  return connectOrReset("command", () =>
    createClient({
      url: env.VALKEY_URL,
      // redis@6 defaults to RESP3 + a 5s command timeout. Keep RESP3 (Valkey-
      // compatible) but restore no-timeout command behavior and disable Redis
      // Enterprise maintenance notifications (not applicable to Valkey).
      commandOptions: { timeout: undefined },
      maintNotifications: "disabled",
      socket: redisSocketOptions(),
    }),
  )
}

export async function getSubscriberClient(): Promise<RedisClientType> {
  return connectOrReset("subscriber", () =>
    createClient({
      url: env.VALKEY_URL,
      commandOptions: { timeout: undefined },
      maintNotifications: "disabled",
      socket: redisSocketOptions(),
    }),
  )
}

export async function shutdownRedis(): Promise<void> {
  await Promise.allSettled([slot.command?.quit(), slot.subscriber?.quit()])
  slot.command = undefined
  slot.subscriber = undefined
}
