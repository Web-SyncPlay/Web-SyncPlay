import type {
  LocalPlaybackReport,
  ParticipantState,
  PresencePatch,
  SessionKind,
} from "@/zod/types"

export type LocalPlaybackSnapshot = ParticipantState["localPlayback"]

/** Drop reports that miss several presence heartbeats (2s cadence). */
export const LOCAL_PLAYBACK_REPORT_STALE_MS = 15_000

const SESSION_PRIORITY: Record<SessionKind, number> = {
  player: 3,
  room: 2,
  embed: 2,
  control: 1,
}

export function pruneLocalPlaybackReports(
  reports: Record<string, LocalPlaybackReport>,
  now: number,
): Record<string, LocalPlaybackReport> {
  const next: Record<string, LocalPlaybackReport> = {}
  for (const [connectionId, report] of Object.entries(reports)) {
    if (now - report.updatedAt <= LOCAL_PLAYBACK_REPORT_STALE_MS) {
      next[connectionId] = report
    }
  }
  return next
}

/**
 * Collapse per-connection playback reports into the single user-facing slot.
 *
 * Ready wins: `loading` is true only when every fresh report is still loading.
 * Clock/pause prefer a ready reporter, then player > room > control, then recency.
 */
export function aggregateLocalPlaybackReports(
  reports: Record<string, LocalPlaybackReport>,
  now = Date.now(),
): LocalPlaybackSnapshot | undefined {
  const fresh = Object.values(pruneLocalPlaybackReports(reports, now))
  if (fresh.length === 0) return undefined

  const ranked = [...fresh].sort((a, b) => {
    if (a.loading !== b.loading) return a.loading ? 1 : -1
    const bySession =
      SESSION_PRIORITY[b.sessionKind] - SESSION_PRIORITY[a.sessionKind]
    if (bySession !== 0) return bySession
    return b.updatedAt - a.updatedAt
  })
  const primary = ranked[0]!

  const aggregated: LocalPlaybackSnapshot = {
    paused: primary.paused,
    currentTimeMs: primary.currentTimeMs,
    loading: fresh.every((report) => report.loading),
    updatedAt: Math.max(...fresh.map((report) => report.updatedAt)),
  }
  // Prefer the primary (ready) reporter's error so a buffering/errored
  // secondary tab cannot override a healthy player/room view.
  if (primary.error !== undefined) {
    aggregated.error = primary.error
  }
  return aggregated
}

export function clientPresencePatch(patch: PresencePatch): PresencePatch {
  if (!patch.localPlaybackReports) return patch
  const { localPlaybackReports: _reports, ...rest } = patch
  return rest
}

export function upsertLocalPlaybackReport(input: {
  reports: Record<string, LocalPlaybackReport>
  connectionId: string
  sessionKind: SessionKind
  snapshot: LocalPlaybackSnapshot
}): Record<string, LocalPlaybackReport> {
  const report: LocalPlaybackReport = {
    sessionKind: input.sessionKind,
    paused: input.snapshot.paused,
    currentTimeMs: input.snapshot.currentTimeMs,
    loading: input.snapshot.loading,
    updatedAt: input.snapshot.updatedAt,
  }
  if (input.snapshot.error !== undefined) {
    report.error = input.snapshot.error
  }
  return pruneLocalPlaybackReports(
    {
      ...input.reports,
      [input.connectionId]: report,
    },
    input.snapshot.updatedAt,
  )
}

export function removeLocalPlaybackReport(
  reports: Record<string, LocalPlaybackReport>,
  connectionId: string,
  now = Date.now(),
): Record<string, LocalPlaybackReport> {
  if (!(connectionId in reports)) {
    return pruneLocalPlaybackReports(reports, now)
  }
  const next = { ...reports }
  delete next[connectionId]
  return pruneLocalPlaybackReports(next, now)
}
