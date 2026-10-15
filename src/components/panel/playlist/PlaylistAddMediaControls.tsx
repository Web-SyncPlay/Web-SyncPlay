"use client"

import {
  canUseFileSystemAccess,
  pickLocalMediaFileWithFsa,
} from "@/client/local-media/local-media-handles"
import { takeLandingLocalMediaHandoff } from "@/client/local-media/local-media-landing-handoff"
import { shareLocalMediaFile } from "@/client/local-media/share-local-media-file"
import { queueNativePlaylistMetadataProbe } from "@/client/player/native-playlist-metadata-probe"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import { useEffect, useRef, useState, type ReactNode } from "react"
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
  const handoffConsumedRef = useRef(false)

  const shareLocalFile = async (file: File, handle?: FileSystemFileHandle) => {
    if (!canManagePlaylist) return

    setSharingLocal(true)
    try {
      const result = await shareLocalMediaFile({
        file,
        handle,
        roomId,
        userId,
        send,
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        handle
          ? "Sharing local media (survives refresh in this browser)"
          : "Sharing local media (streamed from this browser)",
      )
    } catch (error) {
      console.error("[playlist] failed local media share", error)
      toast.error("Could not share local media")
    } finally {
      setSharingLocal(false)
      if (localFileInputRef.current) localFileInputRef.current.value = ""
    }
  }

  useEffect(() => {
    if (!canManagePlaylist || handoffConsumedRef.current) return
    const handoff = takeLandingLocalMediaHandoff(roomId)
    if (!handoff) return
    handoffConsumedRef.current = true
    let cancelled = false
    void (async () => {
      setSharingLocal(true)
      try {
        const result = await shareLocalMediaFile({
          file: handoff.file,
          handle: handoff.handle,
          roomId,
          userId,
          send,
        })
        if (cancelled) return
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success(
          handoff.handle
            ? "Sharing local media (survives refresh in this browser)"
            : "Sharing local media (streamed from this browser)",
        )
      } catch (error) {
        if (cancelled) return
        console.error("[playlist] failed landing local media handoff", error)
        toast.error("Could not share local media")
      } finally {
        if (!cancelled) setSharingLocal(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canManagePlaylist, roomId, userId, send])

  const addMedia = () => {
    const trimmedUrl = url.trim()
    if (!canManagePlaylist || !trimmedUrl) return
    send("playlist:add:url", { url: trimmedUrl })
    // Adder-only: hidden embed fills YouTube/Vimeo title + duration.
    queueNativePlaylistMetadataProbe(trimmedUrl)
    setUrl("")
    toast.success("Added URL, resolving metadata in background")
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
