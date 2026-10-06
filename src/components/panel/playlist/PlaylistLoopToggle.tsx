"use client"

import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { LoopMode } from "@/zod/types"
import { Repeat, Repeat1, RepeatOff } from "lucide-react"

const LOOP_CYCLE: LoopMode[] = ["off", "once", "always"]

const LOOP_META: Record<
  LoopMode,
  { label: string; Icon: typeof Repeat }
> = {
  off: { label: "Loop off", Icon: RepeatOff },
  once: { label: "Loop one", Icon: Repeat1 },
  always: { label: "Loop", Icon: Repeat },
}

export function nextPlaylistLoopMode(current: LoopMode): LoopMode {
  const index = LOOP_CYCLE.indexOf(current)
  return LOOP_CYCLE[(index + 1) % LOOP_CYCLE.length]!
}

export function PlaylistLoopToggle(props: {
  mode: LoopMode
  interactive: boolean
  onCycle?: () => void
  className?: string
}) {
  const { mode, interactive, onCycle, className } = props
  const { label, Icon } = LOOP_META[mode]

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(
          buttonVariants({ variant: "outline", size: "icon-sm" }),
          "size-8 min-h-11 touch-manipulation sm:min-h-8",
          !interactive && "cursor-default opacity-90",
          className,
        )}
        aria-label={label}
        aria-pressed={mode !== "off"}
        aria-disabled={!interactive}
        onClick={() => {
          if (!interactive) return
          onCycle?.()
        }}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
