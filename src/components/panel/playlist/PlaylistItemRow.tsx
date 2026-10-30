import { useSortable } from "@dnd-kit/react/sortable"
import { Copy, GripVertical, Loader2, Play, Trash2 } from "lucide-react"
import { useLayoutEffect, useState } from "react"
import { toast } from "sonner"

import { cn } from "@/components/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { PlaylistItem } from "@/contracts/types"

async function copySourceUrl(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success("URL copied")
  } catch {
    toast.error("Could not copy URL")
  }
}

const SORTABLE_ROW_A11Y_ATTRS = [
  "role",
  "aria-roledescription",
  "aria-describedby",
  "aria-disabled",
  "aria-pressed",
  "aria-grabbed",
  "tabindex",
] as const

/**
 * dnd-kit may briefly (or when the handle is absent) apply keyboard-drag ARIA to
 * the sortable row. That creates nested interactive controls / invalid attrs
 * because the row contains buttons. Keep those attributes on the handle only.
 */
function useStripSortableRowA11y(row: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!row) return

    const strip = () => {
      if (row.getAttribute("role") === "button") {
        row.removeAttribute("role")
      }
      for (const attr of SORTABLE_ROW_A11Y_ATTRS) {
        if (attr === "role") continue
        if (row.hasAttribute(attr)) row.removeAttribute(attr)
      }
    }

    strip()
    const observer = new MutationObserver(strip)
    observer.observe(row, {
      attributes: true,
      attributeFilter: [...SORTABLE_ROW_A11Y_ATTRS],
    })
    return () => observer.disconnect()
  }, [row])
}

export function localFileOriginLabel(username: string): string {
  const trimmed = username.trim()
  return trimmed ? `${trimmed}'s device` : "device"
}

export function PlaylistItemRow(props: {
  item: PlaylistItem
  index: number
  isCurrent: boolean
  itemDuration: string | null
  canControlPlaylist: boolean
  /** Display name for local_file origin; ignored for remote_url. */
  localOriginUsername?: string
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
    localOriginUsername,
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
  const [rowEl, setRowEl] = useState<HTMLDivElement | null>(null)
  useStripSortableRowA11y(rowEl)

  return (
    <Item
      ref={(node) => {
        const el = node as HTMLDivElement | null
        if (rowEl !== el) setRowEl(el)
        ref(el)
      }}
      variant={isCurrent ? "outline" : "muted"}
      className={cn(
        "w-full min-w-0",
        isCurrent ? "border-primary/40 bg-primary/5" : "border-border",
        item.ingestStatus === "error" && "border-destructive/60",
        isDragging && "z-10 opacity-90",
        isDropTarget && "ring-2 ring-ring/40",
      )}
    >
      {canControlPlaylist ? (
        <ItemMedia>
          <Button
            ref={handleRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Drag to reorder"
            className="cursor-grab touch-none active:cursor-grabbing"
          >
            <GripVertical />
          </Button>
        </ItemMedia>
      ) : null}
      <ItemContent className="min-w-0 justify-center gap-0.5">
        {canControlPlaylist && isEditing ? (
          <Input
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
            {isCurrent ? (
              <Play aria-hidden className="size-3.5 shrink-0 text-primary" />
            ) : (
              <span
                aria-hidden
                className="shrink-0 text-muted-foreground tabular-nums"
              >
                {index + 1}
              </span>
            )}
            {item.ingestStatus === "resolving" && (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
            <span className="truncate">{item.name}</span>
            {itemDuration && (
              <span className="shrink-0 text-muted-foreground">
                {itemDuration}
              </span>
            )}
          </ItemTitle>
        )}
        {item.sourceKind === "remote_url" ? (
          <>
            <Tooltip>
              <TooltipTrigger
                type="button"
                className={cn(
                  "inline-flex w-fit max-w-full min-w-0 items-center gap-0.5 self-start rounded-md",
                  "text-muted-foreground",
                  "active:bg-muted/80 sm:hover:bg-muted/60",
                )}
                aria-label="Copy source URL"
                onClick={(e) => {
                  e.stopPropagation()
                  void copySourceUrl(item.sourceUrl)
                }}
              >
                <span className="min-w-0 truncate">{item.sourceUrl}</span>
                <Copy className="size-3 shrink-0" />
              </TooltipTrigger>
              <TooltipContent>Copy URL</TooltipContent>
            </Tooltip>
            {item.ingestError ? (
              <p
                className="line-clamp-2 text-destructive"
                title={item.ingestError}
              >
                {item.ingestError}
              </p>
            ) : item.ingestStatus === "resolving" ? (
              <p className="text-muted-foreground">Resolving…</p>
            ) : null}
          </>
        ) : item.sourceKind === "local_file" ? (
          <p className="min-w-0 truncate text-muted-foreground">
            {localFileOriginLabel(
              localOriginUsername ?? item.localOriginUserId ?? item.createdBy,
            )}
          </p>
        ) : null}
      </ItemContent>
      <ItemActions className="shrink-0 gap-1">
        {canControlPlaylist && !isCurrent ? (
          <Button
            variant="secondary"
            size="icon"
            aria-label="Play this item"
            onClick={onSelect}
          >
            <Play />
          </Button>
        ) : null}
        {canControlPlaylist ? (
          <Button
            variant="destructive"
            size="icon"
            aria-label="Remove item"
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        ) : null}
      </ItemActions>
    </Item>
  )
}
