import { randomUUID } from "node:crypto"

const g = globalThis as typeof globalThis & {
  __webSyncPlayAppNodeId?: string
}

/**
 * Stable per-process identity for relay echo-skip, room broadcast echo-skip,
 * and local-media provider affinity (`providerNodeId`).
 */
export function getAppNodeId(): string {
  if (!g.__webSyncPlayAppNodeId) {
    g.__webSyncPlayAppNodeId = randomUUID()
  }
  return g.__webSyncPlayAppNodeId
}
