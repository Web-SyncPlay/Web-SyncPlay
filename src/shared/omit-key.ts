/** Shallow clone without `key` (no discard binding). */
export function omitKey<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): Omit<T, K> {
  const next = { ...obj }
  delete next[key]
  return next
}
