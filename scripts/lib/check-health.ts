/**
 * Shared /api/health probe for e2e and a11y scripts.
 * Requires HTTP OK plus `{ ok: true, valkey: true }`.
 */
export async function checkHealth(baseUrl: string): Promise<{
  ok: boolean
  health: Record<string, unknown>
  status: number
}> {
  const healthRes = await fetch(`${baseUrl.replace(/\/$/, "")}/api/health`)
  const health = (await healthRes.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  const ok =
    healthRes.ok && health.ok === true && health.valkey === true
  return { ok, health, status: healthRes.status }
}
