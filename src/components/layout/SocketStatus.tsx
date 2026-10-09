import type { JoinStatus } from "@/lib/room-join-client"
import { CircleAlert } from "lucide-react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty"
import { Spinner } from "../ui/spinner"

function copyForStatus(
  status: JoinStatus,
  message?: string | null,
): { title: string; description: string; blocked: boolean } {
  if (status === "rate_limited") {
    return {
      title: "Too many join attempts",
      description:
        message ??
        "Too many join attempts. Try again in a moment.",
      blocked: true,
    }
  }
  if (status === "identity_mismatch") {
    return {
      title: "Session identity mismatch",
      description:
        message ??
        "Your session identity does not match this connection. Refresh the page and try again.",
      blocked: true,
    }
  }
  return {
    title: "Connecting to room session",
    description: message
      ? message
      : `Status of websocket connection: ${status}`,
    blocked: false,
  }
}

export function SocketStatus({
  status,
  message,
}: {
  status: JoinStatus
  message?: string | null
}) {
  const copy = copyForStatus(status, message)

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {copy.blocked ? (
            <CircleAlert aria-hidden="true" />
          ) : (
            <Spinner />
          )}
        </EmptyMedia>
        <EmptyTitle>{copy.title}</EmptyTitle>
        <EmptyDescription>{copy.description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent></EmptyContent>
    </Empty>
  )
}
