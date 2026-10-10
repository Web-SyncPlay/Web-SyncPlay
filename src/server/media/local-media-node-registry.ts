import { env } from "@/env"
import { getAppNodeId } from "@/server/node-id"
import { getCommandClient } from "@/server/redis/client"
import { keys } from "@/server/redis/keys"

const NODE_REGISTRY_TTL_SECONDS = 90
const NODE_HEARTBEAT_INTERVAL_MS = 30_000

export type LocalMediaNodeRecord = {
  nodeId: string
  baseUrl: string
  lastSeen: number
}

const g = globalThis as typeof globalThis & {
  __webSyncPlayNodeRegistryHeartbeat?: ReturnType<typeof setInterval>
}

function resolveSelfBaseUrl(): string | null {
  const configured = env.INTERNAL_NODE_BASE_URL?.trim()
  if (configured) {
    return configured.replace(/\/$/, "")
  }
  return null
}

export function isLocalMediaInternalConfigured(): boolean {
  return Boolean(
    env.LOCAL_MEDIA_INTERNAL_SECRET?.trim() && resolveSelfBaseUrl(),
  )
}

/** Health probe for multi-replica local-media HTTP affinity (warn-only). */
export type LocalMediaAffinityHealth = {
  configured: boolean
  /** `configured` when both env vars are set; `missing` when the pair is unset. */
  status: "configured" | "missing"
  /** Present when unset so operators see the silent pub/sub fallback. */
  warn?: string
}

export function getLocalMediaAffinityHealth(): LocalMediaAffinityHealth {
  if (isLocalMediaInternalConfigured()) {
    return { configured: true, status: "configured" }
  }
  return {
    configured: false,
    status: "missing",
    warn: "INTERNAL_NODE_BASE_URL and LOCAL_MEDIA_INTERNAL_SECRET unset; using Redis pub/sub fallback",
  }
}

async function warnIfDuplicateBaseUrl(
  client: Awaited<ReturnType<typeof getCommandClient>>,
  selfNodeId: string,
  baseUrl: string,
): Promise<void> {
  try {
    let cursor = "0"
    do {
      const result = await client.scan(cursor, {
        MATCH: keys.localMediaNodeScanPattern(),
        COUNT: 32,
      })
      cursor = result.cursor
      for (const key of result.keys) {
        const raw = await client.get(String(key))
        if (!raw) continue
        let other: LocalMediaNodeRecord
        try {
          other = JSON.parse(raw) as LocalMediaNodeRecord
        } catch {
          continue
        }
        if (
          other.nodeId &&
          other.nodeId !== selfNodeId &&
          other.baseUrl === baseUrl
        ) {
          console.warn(
            "[local-media-node] INTERNAL_NODE_BASE_URL is shared by multiple node ids; use a per-replica URL",
            { baseUrl, selfNodeId, otherNodeId: other.nodeId },
          )
          return
        }
      }
    } while (cursor !== "0")
  } catch {
    // Best-effort diagnostic only.
  }
}

export async function registerLocalMediaNode(): Promise<void> {
  const baseUrl = resolveSelfBaseUrl()
  if (!baseUrl || !env.LOCAL_MEDIA_INTERNAL_SECRET?.trim()) {
    return
  }

  const record: LocalMediaNodeRecord = {
    nodeId: getAppNodeId(),
    baseUrl,
    lastSeen: Date.now(),
  }

  try {
    const client = await getCommandClient()
    await warnIfDuplicateBaseUrl(client, record.nodeId, baseUrl)
    await client.set(
      keys.localMediaNode(record.nodeId),
      JSON.stringify(record),
      { EX: NODE_REGISTRY_TTL_SECONDS },
    )
  } catch (error) {
    console.warn("[local-media-node] registry write failed", error)
  }
}

export async function getLocalMediaNode(
  nodeId: string,
): Promise<LocalMediaNodeRecord | null> {
  try {
    const client = await getCommandClient()
    const raw = await client.get(keys.localMediaNode(nodeId))
    if (!raw) return null
    const record = JSON.parse(raw) as LocalMediaNodeRecord
    if (!record?.baseUrl || !record?.nodeId) return null
    return record
  } catch (error) {
    console.warn("[local-media-node] registry read failed", error)
    return null
  }
}

/** Heartbeat this process into Redis so other nodes can proxy range misses here. */
export function startLocalMediaNodeHeartbeat(): void {
  if (g.__webSyncPlayNodeRegistryHeartbeat) {
    return
  }
  if (!isLocalMediaInternalConfigured()) {
    return
  }

  void registerLocalMediaNode()
  g.__webSyncPlayNodeRegistryHeartbeat = setInterval(() => {
    void registerLocalMediaNode()
  }, NODE_HEARTBEAT_INTERVAL_MS)
  g.__webSyncPlayNodeRegistryHeartbeat.unref?.()
}
