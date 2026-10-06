"use client"

import { useCallback, useSyncExternalStore } from "react"

export type RoomRailTab = "playlist" | "log"

const RAIL_OPEN_KEY = "web-syncplay:room-rail-open"
const RAIL_TAB_KEY = "web-syncplay:room-rail-tab"

let memoryOpen: boolean | null = null
let memoryTab: RoomRailTab | null = null
const listeners = new Set<() => void>()

function emit() {
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

function readOpen(): boolean {
  if (memoryOpen !== null) {
    return memoryOpen
  }
  if (typeof window === "undefined") {
    return true
  }
  const stored = window.localStorage.getItem(RAIL_OPEN_KEY)
  memoryOpen = stored === null ? true : stored === "1"
  return memoryOpen
}

function readTab(): RoomRailTab {
  if (memoryTab) {
    return memoryTab
  }
  if (typeof window === "undefined") {
    return "playlist"
  }
  const stored = window.localStorage.getItem(RAIL_TAB_KEY)
  memoryTab = stored === "log" ? "log" : "playlist"
  return memoryTab
}

export function useRoomRail() {
  const railOpen = useSyncExternalStore(subscribe, readOpen, () => true)
  const railTab = useSyncExternalStore<RoomRailTab>(
    subscribe,
    readTab,
    (): RoomRailTab => "playlist",
  )

  const setRailOpen = useCallback((next: boolean) => {
    memoryOpen = next
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RAIL_OPEN_KEY, next ? "1" : "0")
    }
    emit()
  }, [])

  const toggleRailOpen = useCallback(() => {
    setRailOpen(!readOpen())
  }, [setRailOpen])

  const setRailTab = useCallback((next: RoomRailTab) => {
    memoryTab = next
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RAIL_TAB_KEY, next)
    }
    emit()
  }, [])

  return {
    railOpen,
    railTab,
    setRailOpen,
    toggleRailOpen,
    setRailTab,
  }
}
