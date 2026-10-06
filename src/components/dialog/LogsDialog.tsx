"use client"

import { LogPanel } from "@/components/panel/log/LogPanel"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { RoomPanelProps } from "@/components/layout/page/types"

export function LogsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  panelProps: RoomPanelProps
}) {
  const { open, onOpenChange, panelProps } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Action log</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <LogPanel {...panelProps} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
