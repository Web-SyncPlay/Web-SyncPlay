import { env } from "@/env"
import { getYtDlpMetrics } from "@/server/media/yt-dlp/metrics"
import {
  derivedExtractFailoverWaitMs,
  derivedLockHeartbeatTtlSeconds,
  derivedResolveReclaimIntervalMs,
  derivedStreamUrlMaxAgeSeconds,
} from "@/server/media/yt-dlp/policy"
import { getCommandClient } from "@/server/redis/client"
import { NextResponse } from "next/server"

export async function GET() {
  let valkeyOk = false
  try {
    const client = await getCommandClient()
    valkeyOk = (await client.ping()) === "PONG"
  } catch {
    valkeyOk = false
  }

  const ok = valkeyOk
  const cacheTtl = env.YTDLP_CACHE_TTL_SECONDS
  const timeoutMs = env.YTDLP_TIMEOUT_MS
  return NextResponse.json(
    {
      ok,
      valkey: valkeyOk,
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
    { status: ok ? 200 : 503 },
  )
}
