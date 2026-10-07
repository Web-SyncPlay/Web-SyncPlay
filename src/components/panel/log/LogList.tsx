import { ItemGroup } from "@/components/ui/item"
import { getActionLogDetails } from "@/lib/log-format"
import type { ActionLogEntry, ParticipantState } from "@/zod/types"

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
      className="gap-1.5 text-xs overflow-y-auto max-h-[80vh]"
    >
      {ordered.map((log) => {
        const actorName =
          log.actorUsername ??
          participants[log.actorUserId]?.username ??
          log.actorUserId

        return (
          <div
            key={log.id}
            role="listitem"
            className="border-b border-border/40 py-1.5 last:border-b-0 text-pretty leading-snug"
          >
            <span className="text-muted-foreground tabular-nums">
              {new Date(log.at).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })}
            </span>
            <span className="text-muted-foreground"> · </span>
            <span className="font-medium">{actorName}</span>
            <span className="text-muted-foreground"> · </span>
            <span>{getActionLogDetails(log)}</span>
          </div>
        )
      })}
    </ItemGroup>
  )
}
