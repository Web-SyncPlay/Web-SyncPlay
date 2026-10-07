import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"

const DEDUPE_WINDOW_MS = 3000
const MAX_ENTRIES = 10_000
const PRUNE_INTERVAL_MS = 5000

type DedupeSlot = {
  map: Map<string, number>
  pruneTimer?: ReturnType<typeof setInterval>
}

function getDedupeSlot(): DedupeSlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayRequestDedupe?: DedupeSlot
  }
  g.__webSyncPlayRequestDedupe ??= { map: new Map() }
  return g.__webSyncPlayRequestDedupe
}

function pruneExpired(map: Map<string, number>, now = Date.now()) {
  for (const [id, at] of map.entries()) {
    if (now - at >= DEDUPE_WINDOW_MS) {
      map.delete(id)
    }
  }
}

function ensurePruneTimer() {
  const slot = getDedupeSlot()
  if (slot.pruneTimer) {
    return
  }
  installShutdownOnce()
  registerShutdownHandler(async () => {
    if (slot.pruneTimer) {
      clearInterval(slot.pruneTimer)
      slot.pruneTimer = undefined
    }
  })
  slot.pruneTimer = setInterval(() => {
    pruneExpired(slot.map)
  }, PRUNE_INTERVAL_MS)
}

/**
 * Returns true if this requestId should be skipped (duplicate within window).
 */
export function shouldSkipDuplicateRequest(requestId: string) {
  ensurePruneTimer()
  const slot = getDedupeSlot()
  const now = Date.now()
  const seen = slot.map.get(requestId)
  if (seen !== undefined && now - seen < DEDUPE_WINDOW_MS) {
    return true
  }
  slot.map.set(requestId, now)
  if (slot.map.size > MAX_ENTRIES) {
    pruneExpired(slot.map, now)
    while (slot.map.size > MAX_ENTRIES) {
      const first = slot.map.keys().next().value
      if (first === undefined) break
      slot.map.delete(first)
    }
  }
  return false
}

/** Test helper: clear dedupe state between cases. */
export function resetRequestDedupeForTests() {
  const slot = getDedupeSlot()
  slot.map.clear()
}
