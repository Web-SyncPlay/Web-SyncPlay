"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TypedRoomEventSender } from "@/lib/room-events"
import { useRef, useState } from "react"
import { toast } from "sonner"

export function PlaylistAddMediaControls(props: {
  roomId: string
  userId: string
  userSecret: string
  send: TypedRoomEventSender
  canManagePlaylist: boolean
  className?: string
}) {
  const { roomId, userId, userSecret, send, canManagePlaylist, className } =
    props
  const [url, setUrl] = useState("")
  const [uploadingLocal, setUploadingLocal] = useState(false)
  const localFileInputRef = useRef<HTMLInputElement>(null)

  const addMedia = () => {
    const trimmedUrl = url.trim()
    if (!canManagePlaylist || !trimmedUrl) return
    send("playlist:add:url", { url: trimmedUrl })
    setUrl("")
    toast.success("Added URL, resolving metadata in background")
  }

  const addLocalMedia = async (file: File) => {
    if (!canManagePlaylist) return
    setUploadingLocal(true)
    try {
      const formData = new FormData()
      formData.set("roomId", roomId)
      formData.set("ownerUserId", userId)
      formData.set("userSecret", userSecret)
      formData.set("file", file)
      const response = await fetch("/api/media/local", {
        method: "POST",
        body: formData,
      })
      if (!response.ok) {
        throw new Error("Failed to register local media")
      }
      const payload = (await response.json()) as {
        localMediaId: string
        name: string
        mimeType?: string
        sizeBytes?: number
      }
      send("playlist:add:local", {
        localMediaId: payload.localMediaId,
        name: payload.name,
        mimeType: payload.mimeType,
        sizeBytes: payload.sizeBytes,
      })
      toast.success("Added local media")
    } catch (error) {
      console.error("[playlist] failed local media upload", error)
      toast.error("Could not add local media")
    } finally {
      setUploadingLocal(false)
      if (localFileInputRef.current) localFileInputRef.current.value = ""
    }
  }

  return (
    <div className={className ?? "flex items-center gap-2"}>
      <Input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="Media URL"
        disabled={!canManagePlaylist}
      />
      <Button onClick={addMedia} disabled={!canManagePlaylist || !url.trim()}>
        Add Media
      </Button>
      <input
        ref={localFileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          void addLocalMedia(file)
        }}
      />
      <Button
        variant="secondary"
        disabled={!canManagePlaylist || uploadingLocal}
        onClick={() => localFileInputRef.current?.click()}
      >
        {uploadingLocal ? "Uploading..." : "Add Local File"}
      </Button>
    </div>
  )
}
