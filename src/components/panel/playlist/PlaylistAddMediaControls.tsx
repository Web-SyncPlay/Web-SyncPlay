"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  canUseFileSystemAccess,
  persistLocalMediaHandle,
  pickLocalMediaFileWithFsa,
} from "@/client/local-media/local-media-handles"
import { resolvePlayableMimeType } from "@/shared/media-mime"
import { registerLocalMediaFile } from "@/client/local-media/local-media-provider"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import { useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"

export function PlaylistAddMediaControls(props: {
  /** Accessible name for the primary add button (defaults to "Add Media"). */
  addButtonLabel?: string
  send: TypedRoomEventSender
  canManagePlaylist: boolean
  roomId: string
  userId: string
  className?: string
  endAddon?: ReactNode
}) {
  const {
    send,
    canManagePlaylist,
    roomId,
    userId,
    className,
    endAddon,
    addButtonLabel = "Add Media",
  } = props
  const [url, setUrl] = useState("")
  const [sharingLocal, setSharingLocal] = useState(false)
  const localFileInputRef = useRef<HTMLInputElement>(null)

  const addMedia = () => {
    const trimmedUrl = url.trim()
    if (!canManagePlaylist || !trimmedUrl) return
    send("playlist:add:url", { url: trimmedUrl })
    setUrl("")
    toast.success("Added URL, resolving metadata in background")
  }

  const shareLocalFile = async (
    file: File,
    handle?: FileSystemFileHandle,
  ) => {
    if (!canManagePlaylist) return

    const mimeType = resolvePlayableMimeType(file.type, file.name)
    if (!mimeType) {
      toast.error("Only video or audio files can be shared")
      return
    }
    if (file.size <= 0) {
      toast.error("File is empty")
      return
    }

    setSharingLocal(true)
    try {
      const localMediaId = crypto.randomUUID()
      // Keep the File in-tab — no upload. Viewers pull byte ranges via the server relay.
      registerLocalMediaFile(localMediaId, file, mimeType)
      if (handle) {
        await persistLocalMediaHandle({
          localMediaId,
          roomId,
          userId,
          filename: file.name || "Local media",
          mimeType,
          sizeBytes: file.size,
          handle,
        })
      }
      const { probeLocalMediaDurationSec, runLocalMediaAbrPublish } =
        await import("@/client/local-media/local-media-abr")
      const durationSeconds = await probeLocalMediaDurationSec(file)
      send("playlist:add:local", {
        localMediaId,
        name: file.name || "Local media",
        mimeType,
        sizeBytes: file.size,
        ...(durationSeconds !== null
          ? { durationSeconds: Math.round(durationSeconds) }
          : {}),
      })
      send("local-media:ready", { localMediaId, ready: true })
      toast.success(
        handle
          ? "Sharing local media (survives refresh in this browser)"
          : "Sharing local media (streamed from this browser)",
      )
      void runLocalMediaAbrPublish({
        parentLocalMediaId: localMediaId,
        file,
        mimeType,
        name: file.name || "Local media",
        send,
      })
    } catch (error) {
      console.error("[playlist] failed local media share", error)
      toast.error("Could not share local media")
    } finally {
      setSharingLocal(false)
      if (localFileInputRef.current) localFileInputRef.current.value = ""
    }
  }

  const onShareLocalClick = async () => {
    if (!canManagePlaylist || sharingLocal) return
    if (canUseFileSystemAccess()) {
      try {
        const picked = await pickLocalMediaFileWithFsa()
        if (!picked) return
        await shareLocalFile(picked.file, picked.handle)
        return
      } catch (error) {
        console.warn(
          "[playlist] File System Access failed; falling back to input",
          error,
        )
      }
    }
    localFileInputRef.current?.click()
  }

  return (
    <div
      className={
        className ??
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      }
    >
      <Input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Media URL"
        aria-label="Media URL"
        disabled={!canManagePlaylist}
        className="min-h-11 touch-manipulation sm:min-h-8 sm:min-w-48 sm:flex-1"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            addMedia()
          }
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          className="min-h-11 flex-1 touch-manipulation sm:min-h-8 sm:flex-none"
          onClick={addMedia}
          disabled={!canManagePlaylist || !url.trim()}
        >
          {addButtonLabel}
        </Button>
        <input
          ref={localFileInputRef}
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            void shareLocalFile(file)
          }}
        />
        <Button
          variant="secondary"
          className="min-h-11 touch-manipulation sm:min-h-8"
          disabled={!canManagePlaylist || sharingLocal}
          onClick={() => void onShareLocalClick()}
        >
          {sharingLocal ? "Sharing..." : "Share Local File"}
        </Button>
        {endAddon}
      </div>
    </div>
  )
}
