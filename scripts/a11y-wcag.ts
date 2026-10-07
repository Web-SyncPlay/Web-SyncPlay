/**
 * WCAG 2.2 accessibility scan for all UI routes.
 *
 * Required: AA (wcag2a, wcag2aa, wcag22aa) and AAA (wcag2aaa, wcag22aaa).
 * Exit 1 on any AA or AAA-only violation.
 *
 * Expects a running app at E2E_BASE_URL (default http://localhost:3000).
 * Room / embed routes need Valkey + a healthy /api/health.
 */
import { AxeBuilder } from "@axe-core/playwright"
import type { Result } from "axe-core"
import { randomUUID } from "node:crypto"
import type { BrowserContext, Page } from "playwright"
import { chromium } from "playwright"
import { checkHealth } from "./lib/check-health.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.A11Y_ROOM_ID ?? `a11y-${Date.now().toString(36)}`

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"]
const AAA_TAGS = ["wcag2aaa", "wcag22aaa"]

type RouteSpec = {
  name: string
  path: string
  prepare?: (page: Page) => Promise<void>
}

type ScanResult = {
  name: string
  aa: Result[]
  aaa: Result[]
  url: string
}

const STATIC_ROUTES: RouteSpec[] = [
  { name: "landing", path: "/" },
  { name: "imprint", path: "/imprint" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
]

function formatViolations(violations: Result[]) {
  if (!violations.length) return "none"
  return violations
    .map((v) => {
      const nodes = v.nodes
        .slice(0, 5)
        .map(
          (n) =>
            `    - ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[0] ?? n.html.slice(0, 80)}`,
        )
        .join("\n")
      const more =
        v.nodes.length > 5 ? `\n    …and ${v.nodes.length - 5} more nodes` : ""
      return `  [${v.impact ?? "unknown"}] ${v.id}: ${v.help} (${v.nodes.length})\n${nodes}${more}\n    ${v.helpUrl}`
    })
    .join("\n")
}

/** Prefer display name only — never write the user secret to storage here. */
async function seedUsername(context: BrowserContext, userId: string) {
  await context.addInitScript(
    ({ userId }) => {
      localStorage.setItem("web-syncplay:username", userId.slice(0, 8))
    },
    { userId },
  )
}

/**
 * Bootstrap identity through the app's hash consumer, which encrypts the secret
 * before persisting (see consumeSessionIdentityFromHash). Avoids cleartext
 * localStorage writes that CodeQL flags in this script.
 */
function identityHash(
  userId: string,
  userSecret: string,
  controlToken?: string,
) {
  let hash = `uid=${encodeURIComponent(userId)}&secret=${encodeURIComponent(userSecret)}`
  if (controlToken) {
    hash += `&ct=${encodeURIComponent(controlToken)}`
  }
  return `#${hash}`
}

async function waitForConnected(page: Page, timeoutMs = 45_000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to room session"),
    undefined,
    { timeout: timeoutMs },
  )
}

async function scanPage(page: Page, routeName: string): Promise<ScanResult> {
  const aa = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze()

  const aaa = await new AxeBuilder({ page }).withTags(AAA_TAGS).analyze()

  // AAA scan also matches AA rules that share tags; keep only AAA-tagged rules.
  const aaaOnly = aaa.violations.filter((v) =>
    (v.tags ?? []).some((t) => AAA_TAGS.includes(t)),
  )

  const result: ScanResult = {
    name: routeName,
    aa: aa.violations,
    aaa: aaaOnly,
    url: page.url(),
  }
  const aaMark = result.aa.length === 0 ? "PASS" : "FAIL"
  const aaaMark = result.aaa.length === 0 ? "PASS" : "FAIL"
  console.log(
    `  → AA ${aaMark} (${result.aa.length}), AAA ${aaaMark} (${result.aaa.length})`,
  )
  return result
}

async function mintControlToken(
  roomId: string,
  userId: string,
  userSecret: string,
) {
  const res = await fetch(`${BASE}/api/control/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, userId, userSecret }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`control token mint failed: ${res.status} ${body}`)
  }
  const data = (await res.json()) as { token?: string }
  if (!data?.token) throw new Error("control token response missing token")
  return data.token
}

async function main() {
  console.log(`A11Y base=${BASE} room=${ROOM}`)
  console.log(`AA tags: ${AA_TAGS.join(", ")}`)
  console.log(`AAA tags (required): ${AAA_TAGS.join(", ")}\n`)

  const { ok: healthOk, health } = await checkHealth(BASE)
  if (!healthOk) {
    console.error(
      "Health check failed — need a running app with healthy Valkey.",
      health,
    )
    process.exit(1)
  }
  console.log("Health OK\n")

  const browser = await chromium.launch({ headless: true })
  const userId = randomUUID()
  const userSecret =
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")

  const results: ScanResult[] = []

  try {
    // Static pages (no identity needed)
    for (const route of STATIC_ROUTES) {
      const context = await browser.newContext()
      const page = await context.newPage()
      page.setDefaultTimeout(30_000)
      console.log(`Scanning ${route.name} (${route.path})…`)
      await page.goto(`${BASE}${route.path}`, { waitUntil: "networkidle" })
      results.push(await scanPage(page, route.name))
      await context.close()
    }

    // Room + embeds share one host identity. Keep the room tab open so the
    // participant stays owner while minting the control token.
    {
      const context = await browser.newContext()
      await seedUsername(context, userId)

      const roomPage = await context.newPage()
      roomPage.setDefaultTimeout(45_000)
      console.log(`Scanning room (/room/${ROOM})…`)
      // Hash bootstrap lets the app encrypt the secret before localStorage write.
      await roomPage.goto(
        `${BASE}/room/${ROOM}${identityHash(userId, userSecret)}`,
        { waitUntil: "domcontentloaded" },
      )
      await waitForConnected(roomPage)
      await roomPage.waitForTimeout(1_000)
      results.push(await scanPage(roomPage, "room"))

      const playerPage = await context.newPage()
      playerPage.setDefaultTimeout(45_000)
      console.log(`Scanning player embed (/room/${ROOM}/player)…`)
      // Same context already holds the encrypted identity from the room join.
      await playerPage.goto(`${BASE}/room/${ROOM}/player`, {
        waitUntil: "domcontentloaded",
      })
      await waitForConnected(playerPage)
      await playerPage.waitForTimeout(1_000)
      results.push(await scanPage(playerPage, "player-embed"))

      const token = await mintControlToken(ROOM, userId, userSecret)
      const controlPage = await context.newPage()
      controlPage.setDefaultTimeout(45_000)
      console.log(`Scanning control embed (/room/${ROOM}/control#…)…`)
      await controlPage.goto(
        `${BASE}/room/${ROOM}/control${identityHash(userId, userSecret, token)}`,
        { waitUntil: "domcontentloaded" },
      )
      await waitForConnected(controlPage)
      await controlPage.waitForTimeout(1_000)
      results.push(await scanPage(controlPage, "control-embed"))

      await context.close()
    }
  } finally {
    await browser.close()
  }

  console.log("\n========== WCAG 2.2 AA (required) ==========")
  let aaFailed = false
  for (const r of results) {
    const ok = r.aa.length === 0
    if (!ok) aaFailed = true
    console.log(`\n[${ok ? "PASS" : "FAIL"}] ${r.name} — ${r.url}`)
    if (!ok) console.log(formatViolations(r.aa))
  }

  console.log("\n========== WCAG 2.2 AAA (required) ==========")
  let aaaFailed = false
  for (const r of results) {
    const ok = r.aaa.length === 0
    if (!ok) aaaFailed = true
    console.log(`\n[${ok ? "PASS" : "FAIL"}] ${r.name} — ${r.url}`)
    if (!ok) console.log(formatViolations(r.aaa))
  }

  const aaTotal = results.reduce((n, r) => n + r.aa.length, 0)
  const aaaTotal = results.reduce((n, r) => n + r.aaa.length, 0)
  console.log(
    `\nSummary: ${results.length} routes scanned; AA violations=${aaTotal}; AAA violations=${aaaTotal}`,
  )

  if (aaFailed || aaaFailed) {
    console.error("\nWCAG 2.2 AAA check failed.")
    process.exit(1)
  }
  console.log("\nWCAG 2.2 AAA check passed.")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
