"use client"

import { useRef, type MutableRefObject } from "react"

/**
 * Keep a ref synchronized with the latest render value for event handlers /
 * timers that must not close over stale props or state.
 */
export function useLatestRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value)
  /* eslint-disable react-hooks/refs -- intentional latest-value sync */
  ref.current = value
  /* eslint-enable react-hooks/refs */
  return ref
}
