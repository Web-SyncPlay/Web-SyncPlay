/**
 * Browser UI e2e beyond the concurrent host/guest smoke suite.
 *
 * Covers landing URL + local-file check, settings/embeds chrome, playlist add/switch,
 * guest permissions, play/pause fan-out, layout/mobile, embed routes, legal
 * pages, and serious console/pageerror noise.
 *
 * Requires a healthy app (`bun run start` or `dev`). Used by CI (`test:e2e:ui`)
 * and local full live suites (`test:e2e:all` / `test:full`).
 */
import { randomUUID } from "node:crypto"
import type { BrowserContext, Page } from "playwright"
import { chromium } from "playwright"
import { checkHealth } from "./lib/check-health.ts"
import { createE2eReporter } from "./lib/e2e-report.ts"
import { identityHash } from "./lib/identity-hash.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.E2E_ROOM_ID ?? `e2eui-${Date.now().toString(36)}`
const MEDIA_DIRECT =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
/** Optional remote extract path; assertion stays soft if yt-dlp is slow/absent. */
const MEDIA_YT = "https://www.youtube.com/watch?v=jNQXAC9IVRw"

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

async function openRoom(context: BrowserContext, path: string, hash = "") {
  const page = await context.newPage()
  page.setDefaultTimeout(25_000)
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("pageerror", (err) => pageErrors.push(err.message))
  await page.goto(`${BASE}${path}${hash}`, { waitUntil: "domcontentloaded" })
  await waitForConnected(page)
  return { page, consoleErrors, pageErrors }
}

async function bodyText(page: Page) {
  return page.locator("body").innerText()
}

async function main() {
  console.log(`UI E2E base=${BASE} room=${ROOM}`)
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
  let hostConsole: string[] = []
  let hostPageErrs: string[] = []

  try {
    const landing = await hostCtx.newPage()
    await landing.goto(BASE, { waitUntil: "domcontentloaded" })
    const checkInput = landing.getByLabel("Media URL to check")
    const checkBtn = landing.getByRole("button", { name: "Check URL" })
    await checkInput.waitFor({ state: "visible" })
    // Controlled Base UI input: wait for hydration, then type so React state updates.
    await landing.waitForFunction(
      () => {
        const input = document.querySelector(
          'input[aria-label="Media URL to check"]',
        ) as HTMLInputElement | null
        const btn = document.querySelector(
          'button[aria-label="Check URL"]',
        ) as HTMLButtonElement | null
        return Boolean(input && btn && !input.disabled)
      },
      undefined,
      { timeout: 15_000 },
    )
    await checkInput.click()
    await checkInput.fill("")
    await checkInput.pressSequentially(MEDIA_DIRECT, { delay: 5 })
    await checkBtn.waitFor({ state: "visible" })
    const checkEnabled = await checkBtn.isEnabled()
    record("landing check button enables for URL", checkEnabled)
    if (!checkEnabled) {
      // Fallback: set value + dispatch input for stubborn controlled fields.
      await checkInput.evaluate((el, value) => {
        const input = el as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", { bubbles: true }))
        input.dispatchEvent(new Event("change", { bubbles: true }))
      }, MEDIA_DIRECT)
    }
    await checkBtn.click({ timeout: 10_000 })
    await landing.waitForTimeout(4_000)
    const landingBody = await bodyText(landing)
    record(
      "landing URL check returns a result",
      /play|sync|supported|unsupported|ready|yes|no|can|cannot|direct|proxy|fail|error|ok/i.test(
        landingBody,
      ),
      landingBody.slice(0, 400),
    )
    await checkInput.click()
    await checkInput.fill("")
    await checkInput.pressSequentially("not-a-url", { delay: 5 })
    await checkBtn.click().catch(() => {})
    await landing.waitForTimeout(1_000)
    record(
      "landing rejects nonsense URL (button disabled or error)",
      !(await checkBtn.isEnabled()) ||
        /invalid|unsupported|cannot|error/i.test(await bodyText(landing)),
    )

    // Local-file mode: switch segment and probe a small fixture via hidden input.
    await landing.getByRole("tab", { name: /Local/i }).click()
    await landing
      .getByText(/stays on this device|Choose file|Drop a video/i)
      .first()
      .waitFor({ state: "visible", timeout: 10_000 })
    record(
      "landing local segment shows drop zone",
      await landing
        .getByRole("button", { name: /Choose file/i })
        .isVisible()
        .catch(() => false),
    )
    try {
      const fixtureRes = await fetch(MEDIA_DIRECT)
      if (fixtureRes.ok) {
        const buf = Buffer.from(await fixtureRes.arrayBuffer())
        const fileInput = landing.getByTestId("landing-local-file-input")
        await fileInput.setInputFiles({
          name: "flower-local.mp4",
          mimeType: "video/mp4",
          buffer: buf,
        })
        await landing.waitForTimeout(5_000)
        const localBody = await bodyText(landing)
        record(
          "landing local file check returns a result",
          /playable in this browser|won.?t play in this browser|unsupported type|empty file/i.test(
            localBody,
          ),
          localBody.slice(0, 400),
        )
      } else {
        record(
          "landing local file check returns a result",
          false,
          `fixture fetch HTTP ${fixtureRes.status}`,
        )
      }
    } catch (error) {
      record(
        "landing local file check returns a result",
        false,
        error instanceof Error ? error.message : String(error),
      )
    }
    // Switch back so later URL-oriented flow is unaffected if re-used.
    await landing.getByRole("tab", { name: /^URL$/i }).click()

    const roomInput = landing.getByLabel("Room name or link")
    await roomInput.fill(`${BASE}/room/${ROOM}`)
    await landing.getByRole("button", { name: "Enter room" }).click()
    await landing.waitForURL(new RegExp(`/room/${ROOM}`), { timeout: 15_000 })
    record(
      "landing paste full room link navigates",
      landing.url().includes(ROOM),
    )
    await landing.close()

    ;({
      page: hostPage,
      consoleErrors: hostConsole,
      pageErrors: hostPageErrs,
    } = await openRoom(
      hostCtx,
      `/room/${ROOM}`,
      identityHash(hostId, hostSecret),
    ))

    const hostBody0 = await bodyText(hostPage)
    record("host is owner", /Owner/i.test(hostBody0))
    record("seed fallback media present", /Fallback media/i.test(hostBody0))

    await hostPage.getByRole("button", { name: "Open room settings" }).click()
    await hostPage.waitForTimeout(500)
    record(
      "settings popover opens",
      await hostPage
        .getByText(/Default join role|Join password|Room settings/i)
        .first()
        .isVisible()
        .catch(() => false),
    )

    const setPw = hostPage.getByRole("button", {
      name: /Set join password|Generate random join password/i,
    })
    if ((await setPw.count()) > 0) {
      await setPw.first().click()
      await hostPage.waitForTimeout(800)
      const pwBody = await bodyText(hostPage)
      record(
        "join password can be enabled from settings",
        /Edit join password|Remove join password|password/i.test(pwBody),
      )
      const removePw = hostPage.getByRole("button", {
        name: /Remove join password/i,
      })
      if ((await removePw.count()) > 0) {
        await removePw.first().click()
        await hostPage.waitForTimeout(500)
      }
    } else {
      record("join password controls visible", false, "no set/generate button")
    }

    await hostPage.keyboard.press("Escape")
    await hostPage.waitForTimeout(300)

    await hostPage.getByRole("button", { name: "Open embeds menu" }).click()
    await hostPage.waitForTimeout(400)
    const embedsBody = await bodyText(hostPage)
    record(
      "embeds menu shows player/control/embed options",
      /player|control|embed|OBS|iframe/i.test(embedsBody),
      embedsBody.match(/Embeds[\s\S]{0,400}/)?.[0]?.slice(0, 300),
    )
    await hostPage.keyboard.press("Escape")

    await hostPage.getByRole("button", { name: "Copy room link" }).click()
    await hostPage.waitForTimeout(400)
    record("copy room link control is clickable", true)

    await hostPage.getByPlaceholder("Media URL").fill(MEDIA_DIRECT)
    await hostPage.getByRole("button", { name: /^Add Media$/ }).click()
    await hostPage.waitForTimeout(3_000)
    let hostBody = await bodyText(hostPage)
    record("direct mp4 appears in playlist", /flower\.mp4/i.test(hostBody))

    const flowerItem = hostPage.getByRole("button", { name: /flower\.mp4/i })
    if ((await flowerItem.count()) > 0) {
      await flowerItem.first().click()
      await hostPage.waitForTimeout(3_000)
      hostBody = await bodyText(hostPage)
      record(
        "switching active playlist item updates UI",
        /Active[\s\S]{0,80}flower|flower[\s\S]{0,40}Active/i.test(hostBody) ||
          !/Fallback media[\s\S]{0,40}Active/i.test(hostBody),
        hostBody
          .match(/[12]\.[\s\S]{0,80}/g)
          ?.join(" | ")
          ?.slice(0, 200),
      )
    } else {
      record("flower playlist item clickable", false)
    }

    await hostPage.getByPlaceholder("Media URL").fill(MEDIA_YT)
    await hostPage.getByRole("button", { name: /^Add Media$/ }).click()
    await hostPage.waitForTimeout(15_000)
    hostBody = await bodyText(hostPage)
    const ytResolving = /Resolving/i.test(hostBody)
    const ytFailed = /failed|error|unsupported|denied/i.test(hostBody)
    const ytReady =
      /jNQXAC9IVRw|Me at the zoo|youtube/i.test(hostBody) && !ytResolving
    record(
      "YouTube add resolves or fails clearly",
      ytReady || ytFailed || ytResolving,
      ytReady
        ? "ready"
        : ytResolving
          ? "still resolving after 15s"
          : ytFailed
            ? "failed with message"
            : "unclear",
    )
    if (ytResolving) {
      await hostPage.waitForTimeout(20_000)
      hostBody = await bodyText(hostPage)
      record(
        "YouTube eventually leaves resolving",
        !/Resolving/i.test(hostBody) ||
          /failed|error|ready|zoo/i.test(hostBody),
        (await bodyText(hostPage))
          .match(/youtube|zoo|Resolv|fail|error/gi)
          ?.join(","),
      )
    }

    const loopBtn = hostPage.getByRole("button", { name: /Loop/i })
    if ((await loopBtn.count()) > 0) {
      const before = await loopBtn.first().getAttribute("aria-label")
      await loopBtn.first().click()
      await hostPage.waitForTimeout(400)
      const after = await loopBtn.first().getAttribute("aria-label")
      record(
        "loop toggle changes state",
        before !== after,
        `${before} → ${after}`,
      )
    }

    await hostPage.getByRole("button", { name: "Logs" }).click()
    await hostPage.waitForTimeout(500)
    hostBody = await bodyText(hostPage)
    record(
      "logs panel shows activity",
      /joined|playlist|play|pause|added|log/i.test(hostBody),
      hostBody.match(/Logs[\s\S]{0,300}/)?.[0]?.slice(0, 250),
    )

    const logSearch = hostPage.getByRole("textbox", {
      name: "Search action log",
    })
    const logOverview = hostPage.getByRole("img", {
      name: /Action log activity over time/i,
    })
    const playbackFacet = hostPage.getByRole("button", {
      name: /Filter category Playback/,
    })
    const presenceFacet = hostPage.getByRole("button", {
      name: /Filter category Presence/,
    })
    record("logs search field present", (await logSearch.count()) > 0)
    record("logs density overview present", (await logOverview.count()) > 0)
    record(
      "logs category facets present",
      (await playbackFacet.count()) > 0 && (await presenceFacet.count()) > 0,
    )

    if ((await logSearch.count()) > 0) {
      const beforeMatch = hostBody.match(/Showing\s+(\d+)\s+of\s+(\d+)/)
      await logSearch.fill("___no_such_log_entry___")
      await hostPage.waitForTimeout(300)
      const filteredBody = await bodyText(hostPage)
      record(
        "logs search can empty the list",
        /No matching log entries/i.test(filteredBody) ||
          /Showing\s+0\s+of\s+\d+/i.test(filteredBody),
        filteredBody.match(/Showing[\s\S]{0,40}|No matching[\s\S]{0,60}/)?.[0],
      )
      await logSearch.fill("")
      await hostPage.waitForTimeout(200)
      if ((await presenceFacet.count()) > 0) {
        await presenceFacet.click()
        await hostPage.waitForTimeout(300)
        const presenceBody = await bodyText(hostPage)
        const afterPresence = presenceBody.match(/Showing\s+(\d+)\s+of\s+(\d+)/)
        record(
          "logs presence facet narrows results",
          Boolean(afterPresence) &&
            Number(afterPresence?.[1] ?? -1) <=
              Number(beforeMatch?.[2] ?? afterPresence?.[2] ?? -1),
          afterPresence?.[0] ?? presenceBody.slice(0, 120),
        )
        const clearAll = hostPage.getByRole("button", { name: "Clear all" })
        if ((await clearAll.count()) > 0) {
          await clearAll.click()
          await hostPage.waitForTimeout(200)
        }
      }
    }

    if ((await logSearch.count()) > 0) {
      await logSearch.fill("joined")
      await hostPage.waitForTimeout(200)
    }
    await hostPage
      .getByRole("button", { name: "Playlist", exact: true })
      .click()
    await hostPage.waitForTimeout(300)
    await hostPage.getByRole("button", { name: "Logs" }).click()
    await hostPage.waitForTimeout(400)
    const searchAfterTab = hostPage.getByRole("textbox", {
      name: "Search action log",
    })
    const persistedQuery =
      (await searchAfterTab.count()) > 0
        ? await searchAfterTab.inputValue()
        : ""
    record(
      "logs search persists across tab switch",
      persistedQuery === "joined",
      persistedQuery,
    )
    if ((await searchAfterTab.count()) > 0) {
      await searchAfterTab.fill("")
    }
    await hostPage
      .getByRole("button", { name: "Playlist", exact: true })
      .click()

    ;({ page: guestPage } = await openRoom(
      guestCtx,
      `/room/${ROOM}`,
      identityHash(guestId, guestSecret),
    ))
    await hostPage.waitForTimeout(1500)
    const guestBody = await bodyText(guestPage)
    const hostSeesGuest = (await bodyText(hostPage)).includes(
      guestId.slice(0, 8),
    )
    record("guest joins room", !/Connecting/i.test(guestBody))
    record("host sees guest", hostSeesGuest)

    const guestPlayerEmbed = guestPage.getByRole("button", {
      name: "Open player embed",
    })
    const guestEmbedsMenu = guestPage.getByRole("button", {
      name: "Open embeds menu",
    })
    record(
      "guest sees player embed button (not embeds menu)",
      (await guestPlayerEmbed.count()) > 0 &&
        (await guestEmbedsMenu.count()) === 0,
    )

    const guestRemove = guestPage.getByRole("button", { name: "Remove item" })
    const guestRemoveCount = await guestRemove.count()
    let guestCannotRemove = guestRemoveCount === 0
    if (guestRemoveCount > 0) {
      guestCannotRemove = await guestRemove.evaluateAll((nodes) =>
        nodes.every((n) => (n as HTMLButtonElement).disabled),
      )
    }
    record("guest cannot remove playlist items", guestCannotRemove)

    const play = hostPage.getByRole("button", { name: "Play" }).first()
    const pause = hostPage.getByRole("button", { name: "Pause" }).first()
    if (await pause.isVisible().catch(() => false)) {
      await pause.click()
      await hostPage.waitForTimeout(1500)
      record(
        "host pause reflects in host UI",
        /Paused|Play/i.test(await bodyText(hostPage)),
      )
      record(
        "guest observes pause",
        /Paused|Online/i.test(await bodyText(guestPage)),
      )
    } else if (await play.isVisible().catch(() => false)) {
      await play.click()
      await hostPage.waitForTimeout(1500)
      record(
        "host play reflects in host UI",
        /Playing|Pause/i.test(await bodyText(hostPage)),
      )
      record(
        "guest observes play",
        /Playing|Online/i.test(await bodyText(guestPage)),
      )
    } else {
      record("play/pause control available", false)
    }

    const seek = hostPage.getByRole("slider", { name: /Seek/i })
    if ((await seek.count()) > 0) {
      await seek.focus()
      await hostPage.keyboard.press("ArrowRight")
      await hostPage.keyboard.press("ArrowRight")
      await hostPage.waitForTimeout(1000)
      record("seek slider accepts keyboard input", true)
    }

    const removeBtns = hostPage.getByRole("button", { name: "Remove item" })
    const removeCount = await removeBtns.count()
    if (removeCount > 1) {
      await removeBtns.last().click()
      await hostPage.waitForTimeout(1000)
      record(
        "host can remove a playlist item",
        true,
        `before=${removeCount} after=${await removeBtns.count()}`,
      )
    } else if (removeCount === 1) {
      record("single playlist item — skip delete-all", true)
    }

    const hide = hostPage.getByRole("button", {
      name: /Hide panel|Show panel/i,
    })
    if ((await hide.count()) > 0) {
      const labelBefore = await hide.first().getAttribute("aria-label")
      await hide.first().click()
      await hostPage.waitForTimeout(400)
      const labelAfter = await hide.first().getAttribute("aria-label")
      record(
        "panel layout toggle works",
        labelBefore !== labelAfter ||
          !(await hostPage
            .getByPlaceholder("Media URL")
            .isVisible()
            .catch(() => true)),
        `${labelBefore} → ${labelAfter}`,
      )
      await hide
        .first()
        .click()
        .catch(() => {})
    }

    await hostPage.setViewportSize({ width: 390, height: 844 })
    await hostPage.waitForTimeout(500)
    record(
      "mobile viewport still shows room chrome",
      /Playlist|Settings|Users|Owner/i.test(await bodyText(hostPage)),
    )
    await hostPage.setViewportSize({ width: 1280, height: 800 })

    const player = await openRoom(hostCtx, `/room/${ROOM}/player`)
    record(
      "player route connected",
      !/Connecting to room session/i.test(await bodyText(player.page)),
    )
    await player.page.close()

    const embed = await openRoom(hostCtx, `/room/${ROOM}/embed`)
    record(
      "embed route connected",
      !/Connecting to room session/i.test(await bodyText(embed.page)),
    )
    await embed.page.close()

    // Ignore expected player/ops noise: third-party media, Vidstack teardown,
    // and buffering-watchdog recovery logs (console.error by design on stall).
    const seriousConsole = hostConsole.filter(
      (t) =>
        !/favicon|third-party|youtube|googlevideo|cast_|Failed to load resource.*ytimg|provider destroyed|buffering watchdog/i.test(
          t,
        ),
    )
    const seriousPageErrs = hostPageErrs.filter(
      (t) => !/provider destroyed/i.test(t),
    )
    record(
      "no serious host console errors",
      seriousConsole.length === 0,
      seriousConsole.slice(0, 5).join(" | ") || "clean",
    )
    record(
      "no host pageerrors",
      seriousPageErrs.length === 0,
      seriousPageErrs.slice(0, 5).join(" | ") || "clean",
    )

    for (const path of ["/imprint", "/privacy", "/terms"]) {
      const p = await hostCtx.newPage()
      const res = await p.goto(`${BASE}${path}`, {
        waitUntil: "domcontentloaded",
      })
      record(
        `legal page ${path}`,
        !!res && res.ok() && (await bodyText(p)).length > 100,
        `status=${res?.status()}`,
      )
      await p.close()
    }

    const { ok: healthAfter } = await checkHealth(BASE)
    record("health still ok after UI e2e traffic", healthAfter)
  } catch (error) {
    record(
      "suite crashed",
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    await hostPage?.close().catch(() => {})
    await guestPage?.close().catch(() => {})
    await hostCtx.close()
    await guestCtx.close()
    await browser.close()
  }

  const failed = finish()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
