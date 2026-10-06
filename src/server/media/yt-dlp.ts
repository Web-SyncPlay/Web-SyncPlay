/**
 * Public yt-dlp extract API.
 *
 * Implementation lives under `./yt-dlp/`:
 * - `extract.ts` — orchestration (cache, lock, spawn)
 * - `parse-dump.ts` — pure JSON dump → streams
 * - `cache.ts` — Valkey envelope + derived stream URL freshness
 * - `extract-lock.ts` — cluster single-flight
 * - `policy.ts` — auto-derived TTLs / format args
 * - `metrics.ts` — process-local counters (exposed via /api/health)
 * - `runner.ts` — process spawn + concurrency
 * - `classify.ts` — stderr / spawn failure → user messages
 */
export type {
  YtDlpExtractFailure,
  YtDlpExtractResult,
  YtDlpExtractSuccess,
  YtDlpMetadata,
  YtDlpNormalizedVariant,
  YtDlpStream,
  YtDlpTextTrack,
} from "@/server/media/yt-dlp/types"

export {
  extractInfo,
  extractMetadata,
  invalidateYtDlpExtractCache,
} from "@/server/media/yt-dlp/extract"

export { getYtDlpMetrics } from "@/server/media/yt-dlp/metrics"
