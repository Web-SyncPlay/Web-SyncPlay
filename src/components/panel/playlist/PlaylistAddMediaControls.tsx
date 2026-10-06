"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { registerLocalMediaFile } from "@/lib/local-media-provider"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { useRef, useState } from "react"
import { toast } from "sonner"

const ALLOWED_MIME_PREFIXES = ["video/", "audio/"]

export function PlaylistAddMediaControls(props: {
  send: TypedRoomEventSender
  canManagePlaylist: boolean
  className?: string
}) {
  const { send, canManagePlaylist, className } = props
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

  const addLocalMedia = (file: File) => {
    if (!canManagePlaylist) return

    const mimeType = file.type || "application/octet-stream"
    if (!ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
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
      registerLocalMediaFile(localMediaId, file)
      send("playlist:add:local", {
        localMediaId,
        name: file.name || "Local media",
        mimeType,
        sizeBytes: file.size,
      })
      send("local-media:ready", { localMediaId, ready: true })
      toast.success("Sharing local media (streamed from this browser)")
    } catch (error) {
      console.error("[playlist] failed local media share", error)
      toast.error("Could not share local media")
    } finally {
      setSharingLocal(false)
      if (localFileInputRef.current) localFileInputRef.current.value = ""
    }
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
        disabled={!canManagePlaylist}
        className="min-h-11 touch-manipulation sm:min-h-8 sm:min-w-48 sm:flex-1"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            addMedia()
          }
        }}
      />
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          className="min-h-11 touch-manipulation sm:min-h-8"
          onClick={addMedia}
          disabled={!canManagePlaylist || !url.trim()}
        >
          Add Media
        </Button>
        <input
          ref={localFileInputRef}
          type="file"
          accept="video/*,audio/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (!file) return
            addLocalMedia(file)
          }}
        />
        <Button
          variant="secondary"
          className="min-h-11 touch-manipulation sm:min-h-8"
          disabled={!canManagePlaylist || sharingLocal}
          onClick={() => localFileInputRef.current?.click()}
        >
          {sharingLocal ? "Sharing..." : "Share Local File"}
        </Button>
      </div>
    </div>
  )
}
