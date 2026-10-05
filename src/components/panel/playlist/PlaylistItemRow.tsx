import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { cn } from "@/lib/utils"
import type { PlaylistItem } from "@/zod/types"
import { useSortable } from "@dnd-kit/react/sortable"
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  PlayCircle,
  RefreshCw,
} from "lucide-react"

export function PlaylistItemRow(props: {
  item: PlaylistItem
  index: number
  isCurrent: boolean
  itemDuration: string | null
  canControlPlaylist: boolean
  playlistLength: number
  draftValue: string
  onDraftChange: (next: string) => void
  onDraftStart: () => void
  onDraftCommit: () => void
  onDraftCancel: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRetry: () => void
}) {
  const {
    item,
    index,
    isCurrent,
    itemDuration,
    canControlPlaylist,
    playlistLength,
    draftValue,
    onDraftChange,
    onDraftStart,
    onDraftCommit,
    onDraftCancel,
    onMoveUp,
    onMoveDown,
    onRetry,
  } = props

  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: item.id,
    index,
    disabled: !canControlPlaylist,
  })

  return (
    <div
      ref={ref}
      className={cn(
        "w-full min-w-0",
        isDragging && "relative z-10 opacity-90",
        isDropTarget && "ring-2 ring-ring/40 rounded-lg",
      )}
    >
      <Item
        variant={isCurrent ? "outline" : "muted"}
        className={cn(item.ingestStatus === "error" && "border-destructive/60")}
      >
        {canControlPlaylist && (
          <ItemMedia>
            <Button
              ref={handleRef}
              variant="ghost"
              aria-label="Drag to reorder"
              className={cn("touch-none cursor-grab active:cursor-grabbing")}
              size={"icon"}
            >
              <GripVertical />
            </Button>
          </ItemMedia>
        )}
        <ItemContent>
          {canControlPlaylist && (
            <Input
              className="h-8 hidden group-hover/item:block group-focus-within/item:block"
              value={draftValue}
              onChange={(e) => onDraftChange(e.target.value)}
              onFocus={onDraftStart}
              onBlur={onDraftCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onDraftCommit()
                  ;(e.target as HTMLInputElement).blur()
                }
                if (e.key === "Escape") {
                  onDraftCancel()
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          )}
          <ItemTitle
            className={cn(
              canControlPlaylist &&
                "group-hover/item:hidden group-focus-within/item:hidden",
            )}
          >
            {isCurrent && <PlayCircle className="size-4 text-emerald-500" />}
            {(item.ingestStatus === "resolving") && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
            {index + 1}. {item.name}
            {itemDuration && (
              <span className="text-xs text-muted-foreground">
                {itemDuration}
              </span>
            )}
          </ItemTitle>
          {item.ingestStatus === "resolving" || item.ingestError ? (
            <p className="text-xs text-muted-foreground">
              {item.sourceUrl}
              {item.ingestError && ` (${item.ingestError})`}
            </p>
          ) : null}
        </ItemContent>
        <ItemActions>
          <Button
            variant="secondary"
            size="icon-sm"
            disabled={
              !canControlPlaylist ||
              item.ingestStatus !== "error" ||
              item.blockedReason === "local_owner_offline"
            }
            onClick={onRetry}
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            disabled={!canControlPlaylist || index === 0}
            onClick={onMoveUp}
          >
            <ArrowUp className="size-3.5" />
          </Button>
          <Button
            variant="secondary"
            size="icon-sm"
            disabled={!canControlPlaylist || index === playlistLength - 1}
            onClick={onMoveDown}
          >
            <ArrowDown className="size-3.5" />
          </Button>
        </ItemActions>
      </Item>
    </div>
  )
}
