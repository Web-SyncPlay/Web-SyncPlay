export type YtDlpMetricKey =
  | "cacheHit"
  | "cacheMiss"
  | "cacheStale"
  | "lockAcquire"
  | "lockWait"
  | "lockWaitTimeout"
  | "lockFailover"
  | "extractOk"
  | "extractFail"
  | "timeout"
  | "spawnError"
  | "upstreamDeniedRefresh"
  | "resolveReclaim"

type YtDlpCounters = Record<YtDlpMetricKey, number>

const counters: YtDlpCounters = {
  cacheHit: 0,
  cacheMiss: 0,
  cacheStale: 0,
  lockAcquire: 0,
  lockWait: 0,
  lockWaitTimeout: 0,
  lockFailover: 0,
  extractOk: 0,
  extractFail: 0,
  timeout: 0,
  spawnError: 0,
  upstreamDeniedRefresh: 0,
  resolveReclaim: 0,
}

export function recordYtDlpMetric(key: YtDlpMetricKey, by = 1) {
  counters[key] += by
}

export function getYtDlpMetrics(): YtDlpCounters {
  return { ...counters }
}

/** Test helper — resets process-local counters. */
export function resetYtDlpMetricsForTest() {
  for (const key of Object.keys(counters) as YtDlpMetricKey[]) {
    counters[key] = 0
  }
}
