/**
 * Build a `#uid=…&secret=…` bootstrap hash for Playwright scripts.
 * The app encrypts the secret before persisting (consumeSessionIdentityFromHash),
 * so scripts never write cleartext secrets to localStorage (CodeQL).
 */
export function identityHash(
  userId: string,
  userSecret: string,
  controlToken?: string,
): string {
  let hash = `uid=${encodeURIComponent(userId)}&secret=${encodeURIComponent(userSecret)}`
  if (controlToken) {
    hash += `&ct=${encodeURIComponent(controlToken)}`
  }
  return `#${hash}`
}
