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
import { GripVertical, Loader2, Play, Trash2 } from "lucide-react"

function JumpingDots() {
  return (
    <span className="inline-flex items-center gap-[2px]" aria-hidden>
      <span className="size-[3px] rounded-full bg-current animate-jump-dot" />
      <span className="size-[3px] rounded-full bg-current animate-jump-dot [animation-delay:150ms]" />
      <span className="size-[3px] rounded-full bg-current animate-jump-dot [animation-delay:300ms]" />
    </span>
  )
}

export function PlaylistItemRow(props: {
  item: PlaylistItem
  index: number
  isCurrent: boolean
  itemDuration: string | null
  canControlPlaylist: boolean
  draftValue: string
  isEditing: boolean
  onDraftChange: (next: string) => void
  onEditStart: () => void
  onDraftCommit: () => void
  onDraftCancel: () => void
  onSelect: () => void
  onRemove: () => void
}) {
  const {
    item,
    index,
    isCurrent,
    itemDuration,
    canControlPlaylist,
    draftValue,
    isEditing,
    onDraftChange,
    onEditStart,
    onDraftCommit,
    onDraftCancel,
    onSelect,
    onRemove,
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
        className={cn(
          "relative items-center border",
          isCurrent
            ? "border-emerald-500/70"
            : "border-border",
          item.ingestStatus === "error" && "border-destructive/60",
        )}
      >
        <span
          className={cn(
            "absolute -top-2 left-2.5 z-10 inline-flex max-w-[calc(100%-1.25rem)] items-center gap-1 truncate rounded-sm bg-card px-1 text-[10px] leading-none font-medium",
            isCurrent ? "text-emerald-500" : "text-muted-foreground",
          )}
        >
          <span>{index + 1}.</span>
          {isCurrent ? (
            <span className="inline-flex items-center gap-1">
              playing
              <JumpingDots />
            </span>
          ) : null}
        </span>
        {canControlPlaylist && (
          <ItemMedia>
            <Button
              ref={handleRef}
              variant="ghost"
              aria-label="Drag to reorder"
              className="touch-none cursor-grab active:cursor-grabbing size-8"
              size="icon-sm"
            >
              <GripVertical />
            </Button>
          </ItemMedia>
        )}
        <ItemContent className="min-w-0 justify-center gap-0.5">
          {canControlPlaylist && isEditing ? (
            <Input
              className="h-8 min-h-8 py-0 text-sm md:text-sm"
              autoFocus
              value={draftValue}
              onChange={(e) => onDraftChange(e.target.value)}
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
          ) : (
            <ItemTitle
              className={cn(
                "h-8 max-w-full min-w-0",
                canControlPlaylist &&
                  "cursor-pointer rounded-md active:bg-muted/80 sm:hover:bg-muted/60",
              )}
              role={canControlPlaylist ? "button" : undefined}
              tabIndex={canControlPlaylist ? 0 : undefined}
              title={canControlPlaylist ? "Rename" : undefined}
              onClick={() => {
                if (!canControlPlaylist) return
                onEditStart()
              }}
              onKeyDown={(e) => {
                if (!canControlPlaylist) return
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onEditStart()
                }
              }}
            >
              {item.ingestStatus === "resolving" && (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              )}
              <span className="truncate">{item.name}</span>
              {itemDuration && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {itemDuration}
                </span>
              )}
            </ItemTitle>
          )}
          {item.ingestStatus === "resolving" || item.ingestError ? (
            <p className="truncate text-xs text-muted-foreground">
              {item.sourceUrl}
              {item.ingestError && ` (${item.ingestError})`}
            </p>
          ) : null}
        </ItemContent>
        <ItemActions className="shrink-0 gap-1 self-center">
          {canControlPlaylist && !isCurrent ? (
            <Button
              variant="secondary"
              size="icon-sm"
              className="size-8"
              aria-label="Play this item"
              onClick={onSelect}
            >
              <Play className="size-4" />
            </Button>
          ) : null}
          {canControlPlaylist ? (
            <Button
              variant="destructive"
              size="icon-sm"
              className="size-8"
              aria-label="Remove item"
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </ItemActions>
      </Item>
    </div>
  )
}
