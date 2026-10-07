import { canPlayNatively } from "@/lib/player-utils"
import {
  invalidateYtDlpExtractCache,
  readExtractCache,
  urlHash,
  writeExtractCache,
} from "@/server/media/yt-dlp/cache"
import { classifyYtDlpRunFailure } from "@/server/media/yt-dlp/classify"
import {
  withYtDlpExtractLock,
  YtDlpExtractLockTimeoutError,
} from "@/server/media/yt-dlp/extract-lock"
import { recordYtDlpMetric } from "@/server/media/yt-dlp/metrics"
import { parseYtDlpDumpJson } from "@/server/media/yt-dlp/parse-dump"
import { derivedYtDlpDumpArgs } from "@/server/media/yt-dlp/policy"
import { runYtDlp } from "@/server/media/yt-dlp/runner"
import type { YtDlpRunFailureKind } from "@/server/media/yt-dlp/runner"
import {
  emptyYtDlpCatalog,
  type YtDlpExtractFailure,
  type YtDlpExtractResult,
  type YtDlpMetadata,
} from "@/server/media/yt-dlp/types"

export { invalidateYtDlpExtractCache }

const inflightByUrl = new Map<string, Promise<YtDlpExtractResult>>()

function logHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return "invalid-url"
  }
}

function recordSpawnishMetrics(
  failureKind: YtDlpRunFailureKind | null | undefined,
) {
  if (failureKind === "timeout") recordYtDlpMetric("timeout")
  if (failureKind === "spawn_error") recordYtDlpMetric("spawnError")
}

function failureResult(
  partial: Pick<
    YtDlpExtractFailure,
    "stderr" | "code" | "classification" | "userMessage"
  >,
): YtDlpExtractFailure {
  return {
    ok: false,
    title: null,
    durationSeconds: null,
    isLive: null,
    ...emptyYtDlpCatalog(),
    bestPlayableUrl: null,
    ...partial,
  }
}

/**
 * Full format extract for playlist resolve. Coalesces in-process and across
 * instances (Valkey lock + cache), and refuses stale CDN URL cache hits.
 */
export async function extractInfo(url: string): Promise<YtDlpExtractResult> {
  const inflight = inflightByUrl.get(url)
  if (inflight) {
    return await inflight
  }
  const done = (async () => {
    const cached = await readExtractCache(url)
    if (cached) {
      return cached
    }
    try {
      return await withYtDlpExtractLock({
        urlHash: urlHash(url),
        readReady: () => readExtractCache(url),
        work: async () => {
          // Re-check after acquiring — another holder may have just written.
          const again = await readExtractCache(url)
          if (again) return again
          const result = await extractInfoUncached(url)
          await writeExtractCache(url, result)
          return result
        },
      })
    } catch (error) {
      if (error instanceof YtDlpExtractLockTimeoutError) {
        recordYtDlpMetric("extractFail")
        return failureResult({
          stderr: error.message,
          code: 1,
          classification: "timeout",
          userMessage: "Timed out while resolving media. Try again.",
        })
      }
      throw error
    }
  })().finally(() => {
    inflightByUrl.delete(url)
  })
  inflightByUrl.set(url, done)
  return await done
}

async function extractInfoUncached(url: string): Promise<YtDlpExtractResult> {
  const result = await runYtDlp(derivedYtDlpDumpArgs(url))
  if (result.code !== 0) {
    const { classification, userMessage } = classifyYtDlpRunFailure({
      stderr: result.stderr,
      failureKind: result.failureKind,
      spawnErrorCode: result.spawnErrorCode,
    })
    recordSpawnishMetrics(result.failureKind)
    recordYtDlpMetric("extractFail")
    console.warn("[yt-dlp] extract failed", {
      host: logHost(url),
      code: result.code,
      classification,
      failureKind: result.failureKind ?? undefined,
    })
    return failureResult({
      stderr: result.stderr,
      code: result.code,
      classification,
      userMessage,
    })
  }

  try {
    const parsed = parseYtDlpDumpJson(result.stdout, result.stderr)
    recordYtDlpMetric("extractOk")
    return parsed
  } catch {
    recordYtDlpMetric("extractFail")
    console.warn("[yt-dlp] JSON parse failed", { host: logHost(url) })
    return failureResult({
      stderr: result.stderr,
      code: result.code,
      classification: "unknown",
      userMessage: "Could not parse media metadata from yt-dlp.",
    })
  }
}

/**
 * Title/duration only. Skips native hosts (player already knows them) and
 * prefers a warm full-extract cache before a lightweight `--print` spawn.
 */
export async function extractMetadata(url: string): Promise<YtDlpMetadata> {
  if (canPlayNatively(url)) {
    return { title: null, durationSeconds: null }
  }

  const cached = await readExtractCache(url)
  if (cached?.ok) {
    return {
      title: cached.title,
      durationSeconds: cached.durationSeconds,
    }
  }

  return await extractMetadataLight(url)
}

async function extractMetadataLight(url: string): Promise<YtDlpMetadata> {
  const result = await runYtDlp([
    "--no-playlist",
    "--skip-download",
    "--print",
    "%(title)s",
    "--print",
    "%(duration)s",
    url,
  ])
  if (result.code !== 0) {
    const { classification } = classifyYtDlpRunFailure({
      stderr: result.stderr,
      failureKind: result.failureKind,
      spawnErrorCode: result.spawnErrorCode,
    })
    recordSpawnishMetrics(result.failureKind)
    console.warn("[yt-dlp] metadata extract failed", {
      host: logHost(url),
      classification,
    })
    return { title: null, durationSeconds: null }
  }

  const lines = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const titleLine = lines[0]
  const durationLine = lines[1]

  const title =
    titleLine &&
    titleLine !== "NA" &&
    titleLine !== "nan" &&
    titleLine.toLowerCase() !== "none"
      ? titleLine
      : null

  let durationSeconds: number | null = null
  if (durationLine && durationLine !== "NA") {
    const parsed = Number(durationLine)
    if (Number.isFinite(parsed) && parsed >= 0) {
      durationSeconds = Math.round(parsed)
    }
  }

  return { title, durationSeconds }
}
