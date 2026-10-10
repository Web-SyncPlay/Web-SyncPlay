import { env } from "@/env"
import { ensureBackgroundMaintenance } from "@/server/maintenance"
import { getLocalMediaAffinityHealth } from "@/server/media/local-media-node-registry"
import { getYtDlpMetrics } from "@/server/media/yt-dlp/metrics"
import {
  derivedExtractFailoverWaitMs,
  derivedLockHeartbeatTtlSeconds,
  derivedResolveReclaimIntervalMs,
  derivedStreamUrlMaxAgeSeconds,
} from "@/server/media/yt-dlp/policy"
import { getCommandClient } from "@/server/redis/client"
import { NextResponse } from "next/server"

async function pingValkey(): Promise<boolean> {
  try {
    const client = await getCommandClient()
    return (await client.ping()) === "PONG"
  } catch {
    return false
  }
}

export async function GET() {
  void ensureBackgroundMaintenance()
  const valkeyOk = await pingValkey()
  const cacheTtl = env.YTDLP_CACHE_TTL_SECONDS
  const timeoutMs = env.YTDLP_TIMEOUT_MS
  // Warn-only: unset affinity / multi-replica SFU locality must not flip liveness
  // (existing single-node deploys stay 200 when Valkey is up).
  const localMediaHttpAffinity = getLocalMediaAffinityHealth()
  // Proxy for multi-node intent: internals configured ⇒ SFU still needs sticky WS + UDP.
  const sfuLocality = localMediaHttpAffinity.configured
    ? {
        status: "warn" as const,
        warn: "Multi-replica env (local-media internals set); SFU is process-local — sticky /api/ws + UDP 40000 must hit the same process; clustering unsupported",
      }
    : { status: "ok" as const }

  return NextResponse.json(
    {
      ok: valkeyOk,
      valkey: valkeyOk,
      localMediaHttpAffinity,
      sfuLocality,
      ytdlpBin: env.YTDLP_BIN,
      ytdlp: {
        maxConcurrent: env.YTDLP_MAX_CONCURRENT,
        timeoutMs,
        cacheTtlSeconds: cacheTtl,
        streamUrlMaxAgeSeconds: derivedStreamUrlMaxAgeSeconds(cacheTtl),
        lockHeartbeatTtlSeconds: derivedLockHeartbeatTtlSeconds(timeoutMs),
        extractFailoverWaitMs: derivedExtractFailoverWaitMs(timeoutMs),
        resolveReclaimIntervalMs: derivedResolveReclaimIntervalMs(timeoutMs),
        metrics: getYtDlpMetrics(),
      },
      nodeEnv: env.NODE_ENV,
    },
    { status: valkeyOk ? 200 : 503 },
  )
}
