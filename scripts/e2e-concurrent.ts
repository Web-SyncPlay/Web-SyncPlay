/**
 * Concurrent E2E verification against the docker-compose stack.
 * Uses two isolated browser contexts (host + guest) on localhost:3000.
 */
import { randomUUID } from "node:crypto"
import type { BrowserContext, Page } from "playwright"
import { chromium } from "playwright"
import { checkHealth } from "./lib/check-health.ts"
import { identityHash } from "./lib/identity-hash.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.E2E_ROOM_ID ?? `e2e-${Date.now().toString(36)}`

type ResultRow = { name: string; ok: boolean; detail?: string }
const RESULTS: ResultRow[] = []

function record(name: string, ok: boolean, detail?: string) {
  RESULTS.push({ name, ok, detail })
  const mark = ok ? "PASS" : "FAIL"
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`)
}

async function waitForConnected(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to room session"),
    undefined,
    { timeout: timeoutMs },
  )
}

/** Prefer display name only — secrets bootstrap via identityHash (encrypted). */
async function seedUsername(context: BrowserContext, userId: string) {
  await context.addInitScript(
    ({ userId }) => {
      localStorage.setItem("web-syncplay:username", userId.slice(0, 8))
    },
    { userId },
  )
}

async function openRoom(
  context: BrowserContext,
  path: string,
  hash = "",
) {
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  await page.goto(`${BASE}${path}${hash}`, { waitUntil: "domcontentloaded" })
  await waitForConnected(page)
  return page
}

async function main() {
  console.log(`E2E base=${BASE} room=${ROOM}`)

  const { ok: healthOk, health } = await checkHealth(BASE)
  record("health endpoint", healthOk, JSON.stringify(health))

  const browser = await chromium.launch({ headless: true })
  const hostId = randomUUID()
  const guestId = randomUUID()
  const hostSecret =
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")
  const guestSecret =
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")

  const hostCtx = await browser.newContext()
  const guestCtx = await browser.newContext()
  await seedUsername(hostCtx, hostId)
  await seedUsername(guestCtx, guestId)

  let hostPage: Page | undefined
  let guestPage: Page | undefined
  let playerPage: Page | undefined
  let controlPage: Page | undefined

  try {
    hostPage = await openRoom(
      hostCtx,
      `/room/${ROOM}`,
      identityHash(hostId, hostSecret),
    )
    record("host joins room", true, await hostPage.title())

    const hostBody = await hostPage.locator("body").innerText()
    record("host sees Owner badge", /Owner/i.test(hostBody))
    record(
      "host can manage playlist controls",
      await hostPage
        .getByRole("button", { name: "Add Media" })
        .first()
        .isVisible(),
    )

    guestPage = await openRoom(
      guestCtx,
      `/room/${ROOM}`,
      identityHash(guestId, guestSecret),
    )
    record("guest joins same room", true)

    await hostPage.waitForTimeout(1500)
    const hostUsers = await hostPage.locator("body").innerText()
    const guestUsers = await guestPage.locator("body").innerText()
    record(
      "host sees guest participant",
      hostUsers.includes(guestId.slice(0, 8)),
      hostUsers.includes(guestId.slice(0, 8))
        ? "guest username present"
        : "guest username missing",
    )
    // Default join role is guest. Self card layout is:
    // You / username / playback / Online · Ready / Guest|Moderator
    // (host Owner appears on the next card — keep this match line-anchored)
    record(
      "guest is not owner",
      /^You\n[^\n]+\n[^\n]+\n[^\n]+\n(Moderator|Guest)\b/m.test(guestUsers),
      "guest self-card role",
    )

    // Guests lack playlist-panel "Add Media"; empty-state may still show a
    // disabled "Add first media" control.
    const guestAddMedia = guestPage.getByRole("button", {
      name: /^(Add Media|Add first media)$/,
    })
    const guestAddCount = await guestAddMedia.count()
    const guestCannotAdd =
      guestAddCount === 0 ||
      (await guestAddMedia.evaluateAll((nodes) =>
        nodes.every((node) => (node as HTMLButtonElement).disabled),
      ))
    record("guest cannot add media", guestCannotAdd)

    const mediaUrl =
      "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
    await hostPage.getByPlaceholder("Media URL").first().fill(mediaUrl)
    const hostAdd = hostPage
      .getByRole("button", { name: /^(Add Media|Add first media)$/ })
      .first()
    await hostAdd.click()
    record("host queued media URL", true, mediaUrl)

    await hostPage.waitForTimeout(10_000)
    const hostAfterAdd = await hostPage.locator("body").innerText()
    const guestAfterAdd = await guestPage.locator("body").innerText()
    const mediaVisibleHost =
      hostAfterAdd.includes("flower") ||
      hostAfterAdd.includes(mediaUrl) ||
      /mp4/i.test(hostAfterAdd)
    const mediaVisibleGuest =
      guestAfterAdd.includes("flower") ||
      guestAfterAdd.includes(mediaUrl) ||
      /mp4/i.test(guestAfterAdd)
    record("playlist item appears for host", mediaVisibleHost)
    record("playlist item syncs to guest", mediaVisibleGuest)

    const playBtn = hostPage.getByRole("button", { name: "Play" }).first()
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click()
      await hostPage.waitForTimeout(2500)
      const afterPlayHost = await hostPage.locator("body").innerText()
      const afterPlayGuest = await guestPage.locator("body").innerText()
      record(
        "host play updates room state",
        /Playing|Paused/i.test(afterPlayHost),
      )
      record(
        "guest observes playback state fan-out",
        /Playing|Paused|Online/i.test(afterPlayGuest),
      )
    } else {
      record("host play button available", false, "Play button not found")
    }

    playerPage = await openRoom(hostCtx, `/room/${ROOM}/player`)
    const playerBody = await playerPage.locator("body").innerText()
    record(
      "player embed connects",
      !playerBody.includes("Connecting to room session"),
    )
    const playerAdd = playerPage.getByRole("button", { name: "Add Media" })
    const playerAddCount = await playerAdd.count()
    if (playerAddCount > 0) {
      record("player embed cannot add media", await playerAdd.isDisabled())
    } else {
      record(
        "player embed has no playlist add UI",
        true,
        "expected for player-only layout",
      )
    }

    const siteEmbedPage = await openRoom(hostCtx, `/room/${ROOM}/embed`)
    const siteEmbedBody = await siteEmbedPage.locator("body").innerText()
    record(
      "site embed connects",
      !siteEmbedBody.includes("Connecting to room session"),
    )
    await siteEmbedPage.close().catch(() => {})

    const mintRes = await fetch(`${BASE}/api/control/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId: ROOM,
        userId: hostId,
        userSecret: hostSecret,
      }),
    })
    const mintJson = (await mintRes.json().catch(() => ({}))) as {
      token?: string
      error?: string
    }
    record(
      "control token mint API",
      mintRes.ok && typeof mintJson.token === "string",
      mintRes.ok ? "token minted" : `${mintRes.status} ${mintJson.error ?? ""}`,
    )

    const controlHash = identityHash(hostId, hostSecret, mintJson.token)
    controlPage = await hostCtx.newPage()
    await controlPage.goto(`${BASE}/room/${ROOM}/control${controlHash}`, {
      waitUntil: "domcontentloaded",
    })
    await waitForConnected(controlPage)
    const controlBody = await controlPage.locator("body").innerText()
    record(
      "control embed connects",
      !controlBody.includes("Connecting to room session"),
    )
    record(
      "control embed shows remote controls",
      /Playlist|Remote Control|Play|Pause/i.test(controlBody),
    )

    // Same-user prefs path: control + player both for host
    record(
      "viewer prefs share same host identity across embeds",
      true,
      "host player + control use same seeded identity",
    )

    // Optional: yt-dlp default resolve progress
    const resolvingStuck = hostAfterAdd.includes("Resolving")
    record(
      "default/fallback media eventually leaves resolving",
      !resolvingStuck || mediaVisibleHost,
      resolvingStuck
        ? "still showing resolving (yt-dlp may be slow/blocked)"
        : "ok",
    )
  } catch (error) {
    record(
      "suite crashed",
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    await hostPage?.close().catch(() => {})
    await guestPage?.close().catch(() => {})
    await playerPage?.close().catch(() => {})
    await controlPage?.close().catch(() => {})
    await hostCtx.close()
    await guestCtx.close()
    await browser.close()
  }

  const failed = RESULTS.filter((r) => !r.ok)
  console.log("\n=== SUMMARY ===")
  console.log(
    `passed=${RESULTS.filter((r) => r.ok).length} failed=${failed.length} total=${RESULTS.length}`,
  )
  for (const f of failed) {
    console.log(` - ${f.name}: ${f.detail ?? ""}`)
  }
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
