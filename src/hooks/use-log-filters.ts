"use client"

import { useCallback, useLayoutEffect, useSyncExternalStore } from "react"

import type { LogActionCategory } from "@/shared/log-format"

/**
 * Action Log query state. Module-scoped and keyed by room so filters survive
 * Logs tab unmount (Shneiderman History task) without writing queries to
 * localStorage.
 */
export type LogFiltersState = {
  categories: LogActionCategory[]
  actions: string[]
  userIds: string[]
  query: string
  timeStartMs: number | null
  timeEndMs: number | null
}

export const defaultLogFiltersState: LogFiltersState = {
  categories: [],
  actions: [],
  userIds: [],
  query: "",
  timeStartMs: null,
  timeEndMs: null,
}

const memoryByRoom = new Map<string, LogFiltersState>()
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

function getOrCreate(roomId: string): LogFiltersState {
  const existing = memoryByRoom.get(roomId)
  if (existing) {
    return existing
  }
  const created = { ...defaultLogFiltersState }
  memoryByRoom.set(roomId, created)
  return created
}

function patchState(roomId: string, patch: Partial<LogFiltersState>) {
  const prev = getOrCreate(roomId)
  memoryByRoom.set(roomId, { ...prev, ...patch })
  emit()
}

function toggleInList<T extends string>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value]
}

export function hasActiveLogFilters(state: LogFiltersState): boolean {
  return (
    state.categories.length > 0 ||
    state.actions.length > 0 ||
    state.userIds.length > 0 ||
    state.query.trim().length > 0 ||
    state.timeStartMs !== null ||
    state.timeEndMs !== null
  )
}

/** Snapshot of room filters (for tests / non-React readers). */
export function peekLogFiltersState(roomId: string): LogFiltersState {
  return getOrCreate(roomId)
}

export function setLogFiltersQuery(roomId: string, query: string) {
  patchState(roomId, { query })
}

export function toggleLogFilterCategory(
  roomId: string,
  category: LogActionCategory,
) {
  const current = getOrCreate(roomId)
  patchState(roomId, {
    categories: toggleInList(current.categories, category),
  })
}

export function toggleLogFilterUser(roomId: string, userId: string) {
  const current = getOrCreate(roomId)
  patchState(roomId, { userIds: toggleInList(current.userIds, userId) })
}

export function toggleLogFilterAction(roomId: string, action: string) {
  const current = getOrCreate(roomId)
  patchState(roomId, { actions: toggleInList(current.actions, action) })
}

export function setLogFiltersTimeRange(
  roomId: string,
  timeStartMs: number | null,
  timeEndMs: number | null,
) {
  patchState(roomId, { timeStartMs, timeEndMs })
}

export function clearLogFilters(roomId: string) {
  memoryByRoom.set(roomId, { ...defaultLogFiltersState })
  emit()
}

/** Clears all rooms — test-only. */
export function resetLogFiltersStoreForTests() {
  memoryByRoom.clear()
  emit()
}

export function useLogFilters(roomId: string) {
  const state = useSyncExternalStore(
    subscribe,
    () => getOrCreate(roomId),
    () => defaultLogFiltersState,
  )

  // Notify subscribers when the active room changes so getSnapshot re-reads.
  useLayoutEffect(() => {
    getOrCreate(roomId)
    emit()
  }, [roomId])

  const setQuery = useCallback(
    (query: string) => {
      setLogFiltersQuery(roomId, query)
    },
    [roomId],
  )

  const toggleCategory = useCallback(
    (category: LogActionCategory) => {
      toggleLogFilterCategory(roomId, category)
    },
    [roomId],
  )

  const toggleUser = useCallback(
    (userId: string) => {
      toggleLogFilterUser(roomId, userId)
    },
    [roomId],
  )

  const toggleAction = useCallback(
    (action: string) => {
      toggleLogFilterAction(roomId, action)
    },
    [roomId],
  )

  const setTimeRange = useCallback(
    (timeStartMs: number | null, timeEndMs: number | null) => {
      setLogFiltersTimeRange(roomId, timeStartMs, timeEndMs)
    },
    [roomId],
  )

  const clearFilters = useCallback(() => {
    clearLogFilters(roomId)
  }, [roomId])

  return {
    ...state,
    hasActiveFilters: hasActiveLogFilters(state),
    setQuery,
    toggleCategory,
    toggleUser,
    toggleAction,
    setTimeRange,
    clearFilters,
  }
}
