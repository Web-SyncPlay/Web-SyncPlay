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
