/**
 * Shared pass/fail recording for e2e scripts.
 */

export type ResultRow = { name: string; ok: boolean; detail?: string }

export function createE2eReporter() {
  const RESULTS: ResultRow[] = []

  function record(name: string, ok: boolean, detail?: string) {
    RESULTS.push({ name, ok, detail })
    console.log(
      `[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`,
    )
  }

  function finish(): number {
    const failed = RESULTS.filter((r) => !r.ok)
    console.log("\n=== SUMMARY ===")
    console.log(
      `passed=${RESULTS.length - failed.length} failed=${failed.length} total=${RESULTS.length}`,
    )
    for (const f of failed) {
      console.log(` - ${f.name}: ${f.detail ?? ""}`)
    }
    return failed.length
  }

  return { record, finish, RESULTS }
}
