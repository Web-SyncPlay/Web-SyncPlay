import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  MoreVertical,
  Pencil,
  Play,
  PlayCircle,
  RefreshCw,
  Trash2,
} from "lucide-react"

export function PlaylistItemRow(props: {
  item: PlaylistItem
  index: number
  isCurrent: boolean
  itemDuration: string | null
  canControlPlaylist: boolean
  playlistLength: number
  draftValue: string
  isEditing: boolean
  onDraftChange: (next: string) => void
  onEditStart: () => void
  onDraftCommit: () => void
  onDraftCancel: () => void
  onSelect: () => void
  onRemove: () => void
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
    isEditing,
    onDraftChange,
    onEditStart,
    onDraftCommit,
    onDraftCancel,
    onSelect,
    onRemove,
    onMoveUp,
    onMoveDown,
    onRetry,
  } = props

  const { ref, handleRef, isDragging, isDropTarget } = useSortable({
    id: item.id,
    index,
    disabled: !canControlPlaylist,
  })

  const canRetry =
    canControlPlaylist &&
    item.ingestStatus === "error" &&
    item.blockedReason !== "local_owner_offline"

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
          "items-start sm:items-center",
          item.ingestStatus === "error" && "border-destructive/60",
        )}
      >
        {canControlPlaylist && (
          <ItemMedia>
            <Button
              ref={handleRef}
              variant="ghost"
              aria-label="Drag to reorder"
              className="touch-none cursor-grab active:cursor-grabbing size-10 sm:size-8"
              size="icon"
            >
              <GripVertical />
            </Button>
          </ItemMedia>
        )}
        <ItemContent className="min-w-0 py-1">
          {canControlPlaylist && isEditing ? (
            <Input
              className="h-10 sm:h-8"
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
                "max-w-full",
                canControlPlaylist &&
                  !isCurrent &&
                  "cursor-pointer rounded-md active:bg-muted/80 sm:hover:bg-muted/60",
              )}
              onClick={() => {
                if (!canControlPlaylist || isCurrent) return
                onSelect()
              }}
            >
              {isCurrent && (
                <PlayCircle className="size-4 shrink-0 text-emerald-500" />
              )}
              {item.ingestStatus === "resolving" && (
                <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
              )}
              <span className="truncate">
                {index + 1}. {item.name}
              </span>
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
              size="icon"
              className="size-10 sm:size-7"
              aria-label="Play this item"
              onClick={onSelect}
            >
              <Play className="size-4" />
            </Button>
          ) : null}
          {canControlPlaylist ? (
            <Button
              variant="destructive"
              size="icon"
              className="size-10 sm:size-7"
              aria-label="Remove item"
              onClick={onRemove}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
          {canControlPlaylist ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="More playlist actions"
                className="inline-flex size-10 items-center justify-center rounded-lg border border-transparent bg-secondary text-secondary-foreground sm:size-7"
              >
                <MoreVertical className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onClick={onEditStart}>
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canRetry} onClick={onRetry}>
                  <RefreshCw />
                  Retry
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={index === 0} onClick={onMoveUp}>
                  <ArrowUp />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={index === playlistLength - 1}
                  onClick={onMoveDown}
                >
                  <ArrowDown />
                  Move down
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </ItemActions>
      </Item>
    </div>
  )
}
