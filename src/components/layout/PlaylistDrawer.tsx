"use client"

import { SidePanel } from "@/components/layout/SidePanel"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ListMusic } from "lucide-react"
import { useState } from "react"
import type { RoomPanelProps } from "./page/types"

export function PlaylistDrawer({
  panelProps,
  offsetForTransport = false,
}: {
  panelProps: RoomPanelProps
  /** Lift the FAB above a sticky transport bar on small screens. */
  offsetForTransport?: boolean
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        variant="secondary"
        className={
          offsetForTransport
            ? "fixed right-4 z-30 shadow-lg touch-manipulation lg:hidden bottom-[calc(11rem+env(safe-area-inset-bottom))]"
            : "fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 shadow-lg touch-manipulation lg:hidden"
        }
        onClick={() => setOpen(true)}
      >
        <ListMusic />
        Playlist
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="px-4 pt-4">
            <DialogTitle>Playlist</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-1 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SidePanel
              panelProps={panelProps}
              className="border-0 shadow-none ring-0"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
