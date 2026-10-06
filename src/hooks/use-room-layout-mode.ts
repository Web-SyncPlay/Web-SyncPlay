"use client"

import { useCallback, useSyncExternalStore } from "react"

export const ROOM_LAYOUT_MODES = ["watch", "manage", "remote"] as const
export type RoomLayoutMode = (typeof ROOM_LAYOUT_MODES)[number]

export const ROOM_LAYOUT_MODE_STORAGE_KEY = "web-syncplay:room-layout-mode"

let memoryMode: RoomLayoutMode | null = null
const listeners = new Set<() => void>()

function isRoomLayoutMode(value: string | null): value is RoomLayoutMode {
  return value === "watch" || value === "manage" || value === "remote"
}

function readStoredLayoutMode(fallback: RoomLayoutMode): RoomLayoutMode {
  if (typeof window === "undefined") {
    return fallback
  }
  const stored = window.localStorage.getItem(ROOM_LAYOUT_MODE_STORAGE_KEY)
  return isRoomLayoutMode(stored) ? stored : fallback
}

function getClientMode(fallback: RoomLayoutMode): RoomLayoutMode {
  if (memoryMode) {
    return memoryMode
  }
  memoryMode = readStoredLayoutMode(fallback)
  return memoryMode
}

function emitLayoutModeChange() {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useRoomLayoutMode(options?: {
  canSwitchModes?: boolean
  defaultMode?: RoomLayoutMode
}) {
  const canSwitchModes = options?.canSwitchModes ?? true
  const defaultMode = options?.defaultMode ?? "watch"

  const storedMode = useSyncExternalStore(
    subscribe,
    () => getClientMode(defaultMode),
    () => defaultMode,
  )

  const layoutMode: RoomLayoutMode = canSwitchModes ? storedMode : "watch"

  const setLayoutMode = useCallback(
    (next: RoomLayoutMode) => {
      if (!canSwitchModes && next !== "watch") {
        return
      }
      memoryMode = next
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ROOM_LAYOUT_MODE_STORAGE_KEY, next)
      }
      emitLayoutModeChange()
    },
    [canSwitchModes],
  )

  return { layoutMode, setLayoutMode }
}
