/**
 * Password-gated room join E2E (WS protocol + Playwright UI).
 *
 * Covers: owner sets join password; missing/wrong password rejected;
 * correct password admits; browser prompt wrong→error / correct→room.
 * Cheap: create-time `initialMediaUrl` / embed `?media=` accept without
 * asserting yt-dlp resolve.
 */
import { randomUUID } from "node:crypto"
import type { Browser, Page } from "playwright"
import { chromium } from "playwright"
import { checkHealth } from "./lib/check-health.ts"
import { createE2eReporter } from "./lib/e2e-report.ts"
import { identityHash } from "./lib/identity-hash.ts"
import { RoomClient } from "./lib/room-ws-client.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const ROOM = process.env.E2E_ROOM_ID ?? `e2epw-${Date.now().toString(36)}`
const PASSWORD = "e2e-join-secret"
const MEDIA_URL =
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"

const { record, finish } = createE2eReporter()

async function waitForConnected(page: Page, timeoutMs = 30_000) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Connecting to room session"),
    undefined,
    { timeout: timeoutMs },
  )
}

async function runWsPasswordGate(): Promise<{ host: RoomClient }> {
  const hostId = randomUUID()
  const guestId = randomUUID()
  const hostSecret = randomUUID().replace(/-/g, "") + "aa"
  const guestSecret = randomUUID().replace(/-/g, "") + "bb"

  const host = new RoomClient({
    baseUrl: BASE,
    roomId: ROOM,
    userId: hostId,
    userSecret: hostSecret,
    username: "PwHost",
  })

  await host.connect()
  await host.waitFor((c) => c.roomState && c.capabilities)
  record("ws host joined", true)
  record(
    "ws host is owner",
    host.roomState?.participants[hostId]?.role === "owner",
  )

  host.send("room:password:set", { password: PASSWORD })
  await host.waitFor(
    (c) => c.roomState?.roomSecurity?.joinPasswordEnabled === true,
    10_000,
  )
  record(
    "ws owner set join password",
    host.roomState?.roomSecurity?.joinPasswordEnabled === true,
  )

  const guestMissing = new RoomClient({
    baseUrl: BASE,
    roomId: ROOM,
    userId: guestId,
    userSecret: guestSecret,
    username: "PwGuest",
  })
  await guestMissing.connect()
  await guestMissing.waitFor((c) => c.rejected, 10_000)
  record(
    "ws join without password rejected",
    guestMissing.rejected?.reason === "password_required",
    String(guestMissing.rejected?.reason ?? "no rejection"),
  )
  guestMissing.close()

  const guestWrong = new RoomClient({
    baseUrl: BASE,
    roomId: ROOM,
    userId: randomUUID(),
    userSecret: randomUUID().replace(/-/g, "") + "cc",
    username: "PwWrong",
    joinPassword: "not-the-password",
  })
  await guestWrong.connect()
  await guestWrong.waitFor((c) => c.rejected, 10_000)
  record(
    "ws join with wrong password rejected",
    guestWrong.rejected?.reason === "invalid_password",
    String(guestWrong.rejected?.reason ?? "no rejection"),
  )
  guestWrong.close()

  const guestOk = new RoomClient({
    baseUrl: BASE,
    roomId: ROOM,
    userId: randomUUID(),
    userSecret: randomUUID().replace(/-/g, "") + "dd",
    username: "PwOk",
    joinPassword: PASSWORD,
  })
  await guestOk.connect()
  await guestOk.waitFor((c) => c.roomState && c.capabilities, 15_000)
  record(
    "ws join with correct password succeeds",
    Boolean(guestOk.roomState && guestOk.capabilities && !guestOk.rejected),
  )
  record(
    "ws admitted guest role is guest",
    guestOk.roomState?.participants[guestOk.userId]?.role === "guest",
  )
  guestOk.close()

  // Keep host socket open so ownership/password state stay live for browser checks.
  return { host }
}

async function runBrowserPasswordPrompt(browser: Browser) {
  const guestId = randomUUID()
  const guestSecret = randomUUID().replace(/-/g, "") + "ee"
  const guestCtx = await browser.newContext()
  await guestCtx.addInitScript(
    ({ userId }) => {
      localStorage.setItem("web-syncplay:username", userId.slice(0, 8))
    },
    { userId: guestId },
  )

  const page = await guestCtx.newPage()
  page.setDefaultTimeout(20_000)

  try {
    await page.goto(
      `${BASE}/room/${ROOM}${identityHash(guestId, guestSecret)}`,
      { waitUntil: "domcontentloaded" },
    )
    await waitForConnected(page)
    const promptVisible = await page
      .getByRole("heading", { name: "Password required" })
      .isVisible()
    record("browser shows password prompt", promptVisible)

    await page.getByLabel("Room join password").fill("wrong-password")
    await page.getByRole("button", { name: "Join room" }).click()
    await page.waitForFunction(
      () => document.body.innerText.includes("Incorrect room password"),
      undefined,
      { timeout: 15_000 },
    )
    record(
      "browser wrong password shows error",
      (await page.locator("body").innerText()).includes(
        "Incorrect room password",
      ),
    )

    await page.getByLabel("Room join password").fill(PASSWORD)
    await page.getByRole("button", { name: "Join room" }).click()
    await page.waitForFunction(
      () =>
        !document.body.innerText.includes("Password required") &&
        !document.body.innerText.includes("Connecting to room session"),
      undefined,
      { timeout: 20_000 },
    )
    const body = await page.locator("body").innerText()
    record(
      "browser correct password enters room",
      !body.includes("Password required") && /Online|Guest|Ready/i.test(body),
    )
  } finally {
    await page.close().catch(() => {})
    await guestCtx.close().catch(() => {})
  }
}

async function runMediaQuerySmoke(browser: Browser) {
  const seedRoom = `e2emedia-${Date.now().toString(36)}`
  const userId = randomUUID()
  const userSecret = randomUUID().replace(/-/g, "") + "ff"

  const ws = new RoomClient({
    baseUrl: BASE,
    roomId: seedRoom,
    userId,
    userSecret,
    username: "MediaSeed",
    initialMediaUrl: MEDIA_URL,
  })
  try {
    await ws.connect()
    await ws.waitFor((c) => c.roomState && c.capabilities, 15_000)
    const hasSeed = (ws.roomState?.playlist ?? []).some(
      (item) => item.sourceUrl === MEDIA_URL || item.sourceUrl?.includes("flower"),
    )
    record(
      "ws create with initialMediaUrl seeds playlist",
      hasSeed || (ws.roomState?.playlist?.length ?? 0) >= 1,
      `playlist=${ws.roomState?.playlist?.length ?? 0}`,
    )
  } finally {
    ws.close()
  }

  const ctx = await browser.newContext()
  await ctx.addInitScript(
    ({ userId: uid }) => {
      localStorage.setItem("web-syncplay:username", uid.slice(0, 8))
    },
    { userId },
  )
  const page = await ctx.newPage()
  page.setDefaultTimeout(20_000)
  try {
    const embedRoom = `e2eembed-${Date.now().toString(36)}`
    await page.goto(
      `${BASE}/room/${embedRoom}/embed?media=${encodeURIComponent(MEDIA_URL)}${identityHash(userId, userSecret)}`,
      { waitUntil: "domcontentloaded" },
    )
    await waitForConnected(page)
    const body = await page.locator("body").innerText()
    record(
      "browser embed ?media= connects",
      !body.includes("Connecting to room session") &&
        !body.includes("Password required"),
      "no yt-dlp assert — connection only",
    )
  } finally {
    await page.close().catch(() => {})
    await ctx.close().catch(() => {})
  }
}

async function main() {
  console.log(`Password-join E2E base=${BASE} room=${ROOM}`)

  const { ok: healthOk, health } = await checkHealth(BASE)
  record("health endpoint", healthOk, JSON.stringify(health))
  if (!healthOk) {
    process.exit(finish() > 0 ? 1 : 1)
  }

  let browser: Browser | undefined
  let host: RoomClient | undefined
  try {
    const gate = await runWsPasswordGate()
    host = gate.host
    browser = await chromium.launch({ headless: true })
    await runBrowserPasswordPrompt(browser)
    await runMediaQuerySmoke(browser)
  } catch (error) {
    record(
      "suite crashed",
      false,
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    host?.close()
    await browser?.close().catch(() => {})
  }

  process.exit(finish() > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
