/** Clamp a finite number into `[min, max]`; non-finite → `fallback`. */
export function clampNumber(
  value: number,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback
  }
  return Math.min(max, Math.max(min, value))
}
