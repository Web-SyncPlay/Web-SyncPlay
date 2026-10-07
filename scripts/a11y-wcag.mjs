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
import { chromium } from "playwright"
import { randomUUID } from "node:crypto"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.A11Y_ROOM_ID ?? `a11y-${Date.now().toString(36)}`

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"]
const AAA_TAGS = ["wcag2aaa", "wcag22aaa"]

/** @typedef {{ name: string; path: string; prepare?: (page: import('playwright').Page) => Promise<void> }} RouteSpec */

/** @type {RouteSpec[]} */
const STATIC_ROUTES = [
  { name: "landing", path: "/" },
  { name: "imprint", path: "/imprint" },
  { name: "privacy", path: "/privacy" },
  { name: "terms", path: "/terms" },
]

function formatViolations(violations) {
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

async function seedIdentity(context, userId, secret) {
  await context.addInitScript(
    ({ userId, secret }) => {
      localStorage.setItem("web-syncplay:user-id", userId)
      localStorage.setItem("web-syncplay:user-secret", secret)
      localStorage.setItem("web-syncplay:username", userId.slice(0, 8))
    },
    { userId, secret },
  )
}

async function waitForConnected(page, timeoutMs = 45_000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to room session"),
    undefined,
    { timeout: timeoutMs },
  )
}

async function scanPage(page, routeName) {
  const aa = await new AxeBuilder({ page }).withTags(AA_TAGS).analyze()

  const aaa = await new AxeBuilder({ page }).withTags(AAA_TAGS).analyze()

  // AAA scan also matches AA rules that share tags; keep only AAA-tagged rules.
  const aaaOnly = aaa.violations.filter((v) =>
    (v.tags ?? []).some((t) => AAA_TAGS.includes(t)),
  )

  const result = {
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

async function mintControlToken(roomId, userId, userSecret) {
  const res = await fetch(`${BASE}/api/control/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, userId, userSecret }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`control token mint failed: ${res.status} ${body}`)
  }
  const data = await res.json()
  if (!data?.token) throw new Error("control token response missing token")
  return data.token
}

async function main() {
  console.log(`A11Y base=${BASE} room=${ROOM}`)
  console.log(`AA tags: ${AA_TAGS.join(", ")}`)
  console.log(`AAA tags (required): ${AAA_TAGS.join(", ")}\n`)

  const healthRes = await fetch(`${BASE}/api/health`)
  const health = await healthRes.json().catch(() => ({}))
  if (!healthRes.ok || health.ok !== true) {
    console.error("Health check failed — is the app running?", health)
    process.exit(1)
  }
  if (health.valkey !== true) {
    console.error("Valkey unhealthy — room routes cannot be scanned.", health)
    process.exit(1)
  }
  console.log("Health OK\n")

  const browser = await chromium.launch({ headless: true })
  const userId = randomUUID()
  const userSecret =
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")

  /** @type {Awaited<ReturnType<typeof scanPage>>[]} */
  const results = []

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
      await seedIdentity(context, userId, userSecret)

      const roomPage = await context.newPage()
      roomPage.setDefaultTimeout(45_000)
      console.log(`Scanning room (/room/${ROOM})…`)
      await roomPage.goto(`${BASE}/room/${ROOM}`, {
        waitUntil: "domcontentloaded",
      })
      await waitForConnected(roomPage)
      await roomPage.waitForTimeout(1_000)
      results.push(await scanPage(roomPage, "room"))

      const playerPage = await context.newPage()
      playerPage.setDefaultTimeout(45_000)
      console.log(`Scanning player embed (/room/${ROOM}/player)…`)
      await playerPage.goto(`${BASE}/room/${ROOM}/player`, {
        waitUntil: "domcontentloaded",
      })
      await waitForConnected(playerPage)
      await playerPage.waitForTimeout(1_000)
      results.push(await scanPage(playerPage, "player-embed"))

      const token = await mintControlToken(ROOM, userId, userSecret)
      const controlHash = `#uid=${encodeURIComponent(userId)}&secret=${encodeURIComponent(userSecret)}&ct=${encodeURIComponent(token)}`
      const controlPage = await context.newPage()
      controlPage.setDefaultTimeout(45_000)
      console.log(`Scanning control embed (/room/${ROOM}/control#…)…`)
      await controlPage.goto(`${BASE}/room/${ROOM}/control${controlHash}`, {
        waitUntil: "domcontentloaded",
      })
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
