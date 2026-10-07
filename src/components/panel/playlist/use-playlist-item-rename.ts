"use client"

import { useState } from "react"
import type { TypedRoomEventSender } from "@/lib/room-events"

/** Local draft + editing id for inline playlist item rename. */
export function usePlaylistItemRename(send: TypedRoomEventSender) {
  const [draftName, setDraftName] = useState<Record<string, string>>({})
  const [editingItemId, setEditingItemId] = useState<string | null>(null)

  const startEdit = (itemId: string, currentName: string) => {
    setDraftName((prev) => ({ ...prev, [itemId]: currentName }))
    setEditingItemId(itemId)
  }

  const cancelEdit = (itemId: string, currentName: string) => {
    setDraftName((prev) => ({ ...prev, [itemId]: currentName }))
    setEditingItemId(null)
  }

  const setDraft = (itemId: string, next: string) => {
    setDraftName((prev) => ({ ...prev, [itemId]: next }))
  }

  const commitEdit = (itemId: string, currentName: string) => {
    const rawDraft = draftName[itemId]
    const trimmed = (rawDraft ?? currentName).trim()
    setEditingItemId(null)
    if (!trimmed || trimmed === currentName) {
      setDraftName((prev) => ({ ...prev, [itemId]: currentName }))
      return
    }
    send("playlist:rename", { itemId, name: trimmed })
  }

  return {
    draftName,
    editingItemId,
    startEdit,
    cancelEdit,
    setDraft,
    commitEdit,
  }
}
