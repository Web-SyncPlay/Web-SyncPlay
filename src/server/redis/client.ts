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

function ensureShutdownRegistered() {
  if (shutdownRegistered) return
  shutdownRegistered = true
  installShutdownOnce()
  registerShutdownHandler(shutdownRedis)
}

export async function getCommandClient(): Promise<RedisClientType> {
  ensureShutdownRegistered()
  if (slot.command?.isOpen) {
    return slot.command
  }

  slot.command ??= createClient({
    url: env.VALKEY_URL,
    // redis@6 defaults to RESP3 + a 5s command timeout. Keep RESP3 (Valkey-
    // compatible) but restore no-timeout command behavior and disable Redis
    // Enterprise maintenance notifications (not applicable to Valkey).
    commandOptions: { timeout: undefined },
    maintNotifications: "disabled",
  })
  if (!slot.command.isOpen) {
    await slot.command.connect()
  }
  return slot.command
}

export async function getSubscriberClient(): Promise<RedisClientType> {
  ensureShutdownRegistered()
  if (slot.subscriber?.isOpen) {
    return slot.subscriber
  }

  slot.subscriber ??= createClient({
    url: env.VALKEY_URL,
    commandOptions: { timeout: undefined },
    maintNotifications: "disabled",
  })
  if (!slot.subscriber.isOpen) {
    await slot.subscriber.connect()
  }
  return slot.subscriber
}

export async function shutdownRedis(): Promise<void> {
  await Promise.allSettled([slot.command?.quit(), slot.subscriber?.quit()])
  slot.command = undefined
  slot.subscriber = undefined
}
