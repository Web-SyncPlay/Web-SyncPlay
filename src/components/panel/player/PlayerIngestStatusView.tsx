"use client"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { PlaylistItem } from "@/contracts/types"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"

const DEFAULT_RESOLVE_ERROR =
  "This URL could not be resolved for playback. Try a direct media link or a supported host."

/**
 * Player chrome when the current item is still resolving or failed ingest —
 * replaces the misleading "No media selected" empty state and avoids MediaError 4
 * from loading the raw page URL.
 */
export function PlayerIngestStatusView(props: {
  item: PlaylistItem
  canControlPlayback: boolean
  onRetry?: () => void
}) {
  const { item, canControlPlayback, onRetry } = props
  const isResolving = item.ingestStatus === "resolving"
  const message =
    item.ingestError?.trim() ||
    (isResolving ? undefined : DEFAULT_RESOLVE_ERROR)

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-3">
      <Empty className="m-0 max-h-full w-full max-w-lg border-border/60 bg-black/20 text-white">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {isResolving ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <AlertTriangle aria-hidden="true" />
            )}
          </EmptyMedia>
          <EmptyTitle>
            {isResolving ? "Resolving media…" : "Media not playable"}
          </EmptyTitle>
          <EmptyDescription className="text-white/75">
            {isResolving
              ? "Fetching streams for this URL. Playback starts when resolution succeeds."
              : message}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-xl gap-3 text-left text-sm text-white/70">
          {item.sourceUrl ? (
            <p className="w-full break-all text-center text-xs text-white/55">
              {item.sourceUrl}
            </p>
          ) : null}
          {!isResolving && canControlPlayback && onRetry ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="gap-1.5"
              onClick={onRetry}
            >
              <RefreshCw className="size-3.5" aria-hidden />
              Retry resolve
            </Button>
          ) : null}
          {!isResolving && !canControlPlayback ? (
            <p className="text-center text-xs text-white/55">
              Ask a room controller to remove this item or try a different URL.
            </p>
          ) : null}
        </EmptyContent>
      </Empty>
    </div>
  )
}
