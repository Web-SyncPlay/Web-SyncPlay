import { ItemGroup } from "@/components/ui/item"
import {
  formatLogTimestamp,
  getActionLogDetails,
} from "@/lib/log-format"
import type { ActionLogEntry, ParticipantState } from "@/zod/types"

function resolveActorName(
  log: ActionLogEntry,
  participants: Record<string, ParticipantState>,
): string {
  return (
    log.actorUsername ??
    participants[log.actorUserId]?.username ??
    log.actorUserId
  )
}

export function LogList(props: {
  logs: ActionLogEntry[]
  participants: Record<string, ParticipantState>
}) {
  const { logs, participants } = props
  // Newest first; toReversed avoids mutating the filtered array on each render.
  const ordered = logs.toReversed()

  if (ordered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No matching log entries</p>
    )
  }

  return (
    <ItemGroup
      role="list"
      className="max-h-[80vh] gap-1.5 overflow-y-auto text-xs"
    >
      {ordered.map((log) => (
        <div
          key={log.id}
          role="listitem"
          className="border-b border-border/40 py-1.5 text-pretty leading-snug last:border-b-0"
        >
          <span className="text-muted-foreground tabular-nums">
            {formatLogTimestamp(log.at)}
          </span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-medium">
            {resolveActorName(log, participants)}
          </span>
          <span className="text-muted-foreground"> · </span>
          <span>{getActionLogDetails(log)}</span>
        </div>
      ))}
    </ItemGroup>
  )
}
