import { clampNumber } from "@/shared/number-utils"

/** Read a clamped number from `localStorage` (SSR-safe fallback). */
export function readClampedNumberFromStorage(
  key: string,
  config: { min: number; max: number; fallback: number },
): number {
  if (typeof window === "undefined") {
    return config.fallback
  }

  const stored = window.localStorage.getItem(key)
  const raw = stored === null ? Number.NaN : Number(stored)
  return clampNumber(raw, config.min, config.max, config.fallback)
}
