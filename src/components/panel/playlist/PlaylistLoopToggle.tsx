"use client"

import { Repeat, Repeat1, RepeatOff } from "lucide-react"

import { touchTargetClass } from "@/components/lib/touch-target"
import { cn } from "@/components/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { LoopMode } from "@/contracts/types"

const LOOP_CYCLE: LoopMode[] = ["off", "once", "always"]

const LOOP_META: Record<LoopMode, { label: string; Icon: typeof Repeat }> = {
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
          buttonVariants({ variant: "outline", size: "icon" }),
          touchTargetClass,
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
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
