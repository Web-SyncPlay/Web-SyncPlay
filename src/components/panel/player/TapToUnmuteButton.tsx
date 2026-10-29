"use client"

import type { MediaPlayerInstance } from "@vidstack/react"
import { Volume2 } from "lucide-react"
import type { RefObject } from "react"

import { touchTargetClass } from "@/components/lib/touch-target"
import { cn } from "@/components/lib/utils"
import { Button } from "@/components/ui/button"

export function TapToUnmuteButton(props: {
  playerRef: RefObject<MediaPlayerInstance | null>
  unmute: () => number
}) {
  const { playerRef, unmute } = props
  return (
    <div className="tap-to-unmute absolute bottom-3 left-1/2 z-30 w-[min(100%-1.5rem,20rem)] -translate-x-1/2">
      <Button
        type="button"
        size="lg"
        className={cn(touchTargetClass, "w-full shadow-lg")}
        onClick={() => {
          const player = playerRef.current
          if (!player) return
          const volume = unmute()
          player.volume = volume
          player.muted = false
        }}
      >
        <Volume2 />
        Tap to unmute
      </Button>
    </div>
  )
}
