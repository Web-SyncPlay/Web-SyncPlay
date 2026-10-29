"use client"

import { CircleAlert } from "lucide-react"

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/** Chrome-less embed error when create-time `?media=` is not usable. */
export function MediaUrlUnsupportedView({
  roomId,
  mediaUrl,
}: {
  roomId: string
  mediaUrl?: string
}) {
  return (
    <section className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden p-6">
      <Empty className="max-w-lg border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CircleAlert aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Media URL not supported</EmptyTitle>
          <EmptyDescription>
            This room could not be created because the{" "}
            <code className="text-foreground">media</code> URL is invalid or
            blocked. Use a public http(s) media link, or open an existing room
            without a new media seed.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="gap-2 text-left text-sm text-muted-foreground">
          <p>
            Room ID:{" "}
            <span className="font-medium break-all text-foreground">
              {roomId}
            </span>
          </p>
          {mediaUrl ? (
            <p>
              Media:{" "}
              <span className="font-medium break-all text-foreground">
                {mediaUrl}
              </span>
            </p>
          ) : null}
        </EmptyContent>
      </Empty>
    </section>
  )
}
