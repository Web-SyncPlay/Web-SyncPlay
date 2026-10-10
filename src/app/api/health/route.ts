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
  // Warn-only: unset affinity must not flip liveness (existing single-node deploys).
  const localMediaHttpAffinity = getLocalMediaAffinityHealth()

  return NextResponse.json(
    {
      ok: valkeyOk,
      valkey: valkeyOk,
      localMediaHttpAffinity,
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
