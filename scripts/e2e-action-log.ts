/**
 * Focused Action Log UI e2e: search, category facets, density overview,
 * and filter persistence across Logs/Playlist tab switches.
 *
 * Requires a healthy app (`bun run start` or `dev`) with Valkey.
 */
import { randomUUID } from "node:crypto"
import type { BrowserContext, Page } from "playwright"
import { chromium } from "playwright"
import { checkHealth } from "./lib/check-health.ts"
import { createE2eReporter } from "./lib/e2e-report.ts"
import { identityHash } from "./lib/identity-hash.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.E2E_ROOM_ID ?? `e2elog-${Date.now().toString(36)}`

const { record, finish } = createE2eReporter()

async function waitForConnected(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to room session"),
    undefined,
    { timeout: timeoutMs },
  )
}

async function seedUsername(context: BrowserContext, userId: string) {
  await context.addInitScript(
    ({ userId }) => {
      localStorage.setItem("web-syncplay:username", userId.slice(0, 8))
    },
    { userId },
  )
}

async function bodyText(page: Page) {
  return page.locator("body").innerText()
}

async function openLogs(page: Page) {
  await page.getByRole("button", { name: "Logs" }).click()
  await page.waitForTimeout(400)
}

async function main() {
  console.log(`Action Log E2E base=${BASE} room=${ROOM}`)
  const { ok: healthOk, health } = await checkHealth(BASE)
  record("health endpoint", healthOk, JSON.stringify(health))
  if (!healthOk) {
    process.exit(finish())
  }

  const browser = await chromium.launch({ headless: true })
  const hostId = randomUUID()
  const hostSecret =
    randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")
  const hostCtx = await browser.newContext()
  await seedUsername(hostCtx, hostId)

  let page: Page | undefined
  try {
    page = await hostCtx.newPage()
    page.setDefaultTimeout(25_000)
    await page.goto(`${BASE}/room/${ROOM}${identityHash(hostId, hostSecret)}`, {
      waitUntil: "domcontentloaded",
    })
    await waitForConnected(page)

    // Generate payload-bearing log entries (playlist add + pause/play).
    const mediaInput = page.getByPlaceholder("Media URL")
    if ((await mediaInput.count()) > 0) {
      await mediaInput.fill(
        "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      )
      const addMedia = page.getByRole("button", { name: /^Add Media$/ })
      if ((await addMedia.count()) > 0) {
        await addMedia.click()
        await page.waitForTimeout(2_500)
      }
    }
    const pause = page.getByRole("button", { name: "Pause" }).first()
    const play = page.getByRole("button", { name: "Play" }).first()
    if (await pause.isVisible().catch(() => false)) {
      await pause.click()
      await page.waitForTimeout(800)
    } else if (await play.isVisible().catch(() => false)) {
      await play.click()
      await page.waitForTimeout(800)
      if (await pause.isVisible().catch(() => false)) {
        await pause.click()
        await page.waitForTimeout(800)
      }
    }

    await openLogs(page)
    const opened = await bodyText(page)
    record(
      "logs panel shows activity",
      /joined|playlist|play|pause|added|Seeked|Paused|Unpaused/i.test(opened),
      opened.match(/Showing[\s\S]{0,40}|Joined[\s\S]{0,40}/)?.[0],
    )

    const search = page.getByRole("textbox", { name: "Search action log" })
    const overview = page.getByRole("img", {
      name: /Action log activity over time/i,
    })
    const playbackFacet = page.getByRole("button", {
      name: /Filter category Playback/,
    })
    const presenceFacet = page.getByRole("button", {
      name: /Filter category Presence/,
    })

    record("logs search field present", (await search.count()) === 1)
    record("logs density overview present", (await overview.count()) === 1)
    record(
      "logs category facets present",
      (await playbackFacet.count()) === 1 &&
        (await presenceFacet.count()) === 1,
    )

    const before = (await bodyText(page)).match(/Showing\s+(\d+)\s+of\s+(\d+)/)
    record("logs shows match count", Boolean(before), before?.[0])

    await search.fill("___no_such_log_entry___")
    await page.waitForTimeout(350)
    const emptyBody = await bodyText(page)
    record(
      "logs search can empty the list",
      /No matching log entries/i.test(emptyBody) ||
        /Showing\s+0\s+of\s+\d+/i.test(emptyBody),
      emptyBody.match(/Showing[\s\S]{0,40}|No matching[\s\S]{0,80}/)?.[0],
    )

    await search.fill("")
    await page.waitForTimeout(250)

    if ((await presenceFacet.count()) > 0) {
      const enabled = await presenceFacet.isEnabled()
      record("presence facet enabled when events exist", enabled)
      if (enabled) {
        await presenceFacet.click()
        await page.waitForTimeout(350)
        const narrowed = (await bodyText(page)).match(
          /Showing\s+(\d+)\s+of\s+(\d+)/,
        )
        record(
          "presence facet narrows or keeps results",
          Boolean(narrowed) &&
            Number(narrowed?.[1] ?? -1) >= 0 &&
            Number(narrowed?.[1] ?? -1) <= Number(narrowed?.[2] ?? -1),
          narrowed?.[0],
        )
        const clearAll = page.getByRole("button", { name: "Clear all" })
        record(
          "clear all appears with active filters",
          (await clearAll.count()) > 0,
        )
        if ((await clearAll.count()) > 0) {
          await clearAll.click()
          await page.waitForTimeout(250)
        }
      }
    }

    await search.fill("joined")
    await page.waitForTimeout(250)
    await page.getByRole("button", { name: "Playlist", exact: true }).click()
    await page.waitForTimeout(350)
    await openLogs(page)
    const persisted = await search.inputValue()
    record(
      "logs search persists across tab switch",
      persisted === "joined",
      persisted,
    )

    // Expand a payload-bearing row (playlist add / playback).
    await search.fill("")
    await page.waitForTimeout(200)
    const detailsBtns = page.getByRole("button", { name: "Show details" })
    record(
      "expandable log rows present",
      (await detailsBtns.count()) > 0,
      `count=${await detailsBtns.count()}`,
    )
    if ((await detailsBtns.count()) > 0) {
      await detailsBtns.first().click()
      await page.waitForTimeout(200)
      record(
        "log row expands payload details",
        (await page.getByRole("button", { name: "Hide details" }).count()) > 0,
      )
    } else {
      record("log row expands payload details", false, "no expandable rows")
    }
  } catch (err) {
    record(
      "suite crashed",
      false,
      err instanceof Error ? err.message : String(err),
    )
  } finally {
    await browser.close()
  }

  process.exit(finish())
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
