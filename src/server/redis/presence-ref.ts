/**
 * Cluster-safe WS presence: HASH field userId → JSON map of nodeId → refcount.
 * Legacy plain integer values (pre-node-scoped) are treated as orphaned so a
 * process crash / compose recreate cannot leave ghost "online" users forever.
 */

export type PresenceNodeCounts = Record<string, number>

export function parsePresenceNodeCounts(raw: string | null | undefined): PresenceNodeCounts {
  if (raw == null || raw === "") return {}

  const asInt = Number.parseInt(raw, 10)
  if (Number.isFinite(asInt) && String(asInt) === raw.trim()) {
    // Legacy refcount with no node identity — assume dead after restart.
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    const out: PresenceNodeCounts = {}
    for (const [nodeId, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const n = typeof value === "number" ? value : Number.parseInt(String(value), 10)
      if (Number.isFinite(n) && n > 0 && nodeId.length > 0) {
        out[nodeId] = Math.floor(n)
      }
    }
    return out
  } catch {
    return {}
  }
}

export function encodePresenceNodeCounts(counts: PresenceNodeCounts): string | null {
  const cleaned: PresenceNodeCounts = {}
  for (const [nodeId, n] of Object.entries(counts)) {
    if (Number.isFinite(n) && n > 0 && nodeId.length > 0) {
      cleaned[nodeId] = Math.floor(n)
    }
  }
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null
}

export function totalPresenceRefs(counts: PresenceNodeCounts): number {
  let sum = 0
  for (const n of Object.values(counts)) {
    if (Number.isFinite(n) && n > 0) sum += n
  }
  return sum
}

/** True when at least one live node holds a positive refcount. */
export function isPresentOnAliveNode(
  counts: PresenceNodeCounts,
  aliveNodeIds: ReadonlySet<string>,
): boolean {
  for (const [nodeId, n] of Object.entries(counts)) {
    if (n > 0 && aliveNodeIds.has(nodeId)) return true
  }
  return false
}

export function bumpPresenceNodeCount(
  counts: PresenceNodeCounts,
  nodeId: string,
  delta: number,
): PresenceNodeCounts {
  const next = { ...counts }
  const n = (next[nodeId] ?? 0) + delta
  if (n <= 0) {
    delete next[nodeId]
  } else {
    next[nodeId] = n
  }
  return next
}
