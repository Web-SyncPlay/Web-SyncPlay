import { ItemGroup } from "@/components/ui/item"
import {
  formatLogTimestamp,
  getActionLogDetails,
} from "@/shared/log-format"
import type { ActionLogEntry } from "@/contracts/types"

function resolveActorName(
  log: ActionLogEntry,
  participantUsernames: Record<string, string>,
): string {
  return (
    log.actorUsername ??
    participantUsernames[log.actorUserId] ??
    log.actorUserId
  )
}

export function LogList(props: {
  logs: ActionLogEntry[]
  participantUsernames: Record<string, string>
}) {
  const { logs, participantUsernames } = props
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
      className="min-h-0 flex-1 gap-1.5 overflow-y-auto text-xs"
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
            {resolveActorName(log, participantUsernames)}
          </span>
          <span className="text-muted-foreground"> · </span>
          <span>{getActionLogDetails(log)}</span>
        </div>
      ))}
    </ItemGroup>
  )
}
