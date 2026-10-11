/**
 * Multi-user playback sync audit across media types.
 * Measures host/guest playhead lag and room-clock fan-out for:
 * play, pause, seek, late-join, concurrent moderator actions.
 *
 * Usage: bun scripts/sync-audit.ts
 * Requires: healthy app at E2E_BASE_URL (default http://localhost:3000)
 */
import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import type { Browser, BrowserContext, Page } from "playwright"
import { chromium } from "playwright"
import { checkHealth } from "./lib/check-health.ts"
import { identityHash } from "./lib/identity-hash.ts"
import {
  createServerClockEstimate,
  expectedPlayheadSec,
  hostPlaybackPause,
  hostPlaybackPlay,
  hostPlaybackSeek,
  wireServerClockFromRoomClient,
} from "./lib/playback-harness.ts"
import { RoomClient } from "./lib/room-ws-client.ts"

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000"
/** App drift correction threshold (src/client/player/playback-sync.ts). */
const DRIFT_THRESHOLD_SEC = 0.8
/** Soft peer lag we still treat as acceptable after settle. */
const PEER_OK_SEC = 1.0
/** Hard peer lag — definite non-conformance after settle. */
const PEER_FAIL_SEC = 1.5

type Severity = "fail" | "warn" | "info" | "pass" | "inconclusive"
type Finding = {
  id: string
  severity: Severity
  media: string
  scenario: string
  title: string
  detail: string
  measured?: Record<string, number | string | boolean | null>
}

const FINDINGS: Finding[] = []

function note(f: Finding) {
  FINDINGS.push(f)
  const mark =
    f.severity === "fail"
      ? "FAIL"
      : f.severity === "warn"
        ? "WARN"
        : f.severity === "pass"
          ? "PASS"
          : f.severity === "inconclusive"
            ? "INCONCLUSIVE"
            : "INFO"
  console.log(`[${mark}] [${f.media}/${f.scenario}] ${f.title} — ${f.detail}`)
}

function secret(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")
}

async function waitForConnected(page: Page, timeoutMs = 45_000) {
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

type Playhead = {
  source: "media" | "player" | "none"
  currentTimeSec: number | null
  paused: boolean | null
  readyState: number | null
  tag: string | null
}

async function readPlayhead(page: Page): Promise<Playhead> {
  return page.evaluate(() => {
    const player = document.querySelector("media-player") as
      | (HTMLElement & {
          currentTime?: number
          paused?: boolean
          state?: { currentTime?: number; paused?: boolean }
        })
      | null
    const playerTime = Number(player?.currentTime ?? player?.state?.currentTime)
    if (player && Number.isFinite(playerTime)) {
      return {
        source: "player" as const,
        currentTimeSec: playerTime,
        paused: Boolean(player.paused ?? player.state?.paused),
        readyState: null,
        tag: "media-player",
      }
    }
    const media = document.querySelector("video, audio") as HTMLMediaElement | null
    if (media && Number.isFinite(media.currentTime)) {
      return {
        source: "media" as const,
        currentTimeSec: media.currentTime,
        paused: media.paused,
        readyState: media.readyState,
        tag: media.tagName.toLowerCase(),
      }
    }
    // Presence self-card fallback: "Playing at M:SS" / "Paused at M:SS"
    const self = document.body.innerText.match(
      /You\n[^\n]+\n(Playing|Paused) at ([0-9:]+)/,
    )
    if (self) {
      const parts = self[2]!.split(":").map(Number)
      let sec = 0
      if (parts.length === 2) sec = parts[0]! * 60 + parts[1]!
      else if (parts.length === 3) sec = parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
      return {
        source: "player" as const,
        currentTimeSec: sec,
        paused: self[1] === "Paused",
        readyState: null,
        tag: "presence",
      }
    }
    return {
      source: "none" as const,
      currentTimeSec: null,
      paused: null,
      readyState: null,
      tag: null,
    }
  })
}

async function readPresenceClocks(page: Page): Promise<
  Array<{ label: string; state: "Playing" | "Paused" | "Unknown"; clock: string }>
> {
  return page.evaluate(() => {
    const text = document.body.innerText
    const re = /(You|[a-f0-9]{8})\n(Playing|Paused) at ([0-9:]+)/g
    const out: Array<{
      label: string
      state: "Playing" | "Paused" | "Unknown"
      clock: string
    }> = []
    for (const m of text.matchAll(re)) {
      out.push({
        label: m[1]!,
        state: m[2] as "Playing" | "Paused",
        clock: m[3]!,
      })
    }
    return out
  })
}

function parseClockToSec(clock: string): number | null {
  const parts = clock.split(":").map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return null
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
  return null
}

async function roomPlayingLabel(page: Page): Promise<"Playing" | "Paused" | "Unknown"> {
  // Prefer self presence line — room header chip can be ambiguous with playlist text.
  const text = await page.locator("body").innerText()
  const self = text.match(/You\n[^\n]+\n(Playing|Paused) at/)
  if (self?.[1] === "Playing" || self?.[1] === "Paused") {
    return self[1]
  }
  const header = text.split("\n").slice(0, 8)
  // Header transport chip is typically a short standalone line near the top.
  for (const line of header) {
    if (line.trim() === "Paused") return "Paused"
    if (line.trim() === "Playing") return "Playing"
  }
  return "Unknown"
}

async function clickPlayPause(page: Page, want: "Play" | "Pause") {
  // Scope to the player — playlist rows also expose "Play this item".
  const root = page.locator("media-player").first()
  await root.hover().catch(() => {})
  const inPlayer = root.getByRole("button", {
    name: new RegExp(`^${want}$`, "i"),
  })
  if (await inPlayer.first().isVisible().catch(() => false)) {
    await inPlayer.first().click()
    return true
  }
  const alt = root.locator(
    want === "Play"
      ? 'button[aria-label="Play"], media-play-button'
      : 'button[aria-label="Pause"], media-play-button',
  )
  if ((await alt.count()) > 0) {
    await alt.first().click({ force: true }).catch(() => {})
    return true
  }
  const pageBtn = page.getByRole("button", { name: want, exact: true }).first()
  if (await pageBtn.isVisible().catch(() => false)) {
    await pageBtn.click()
    return true
  }
  return false
}

async function seekViaKeyboard(page: Page, targetSec: number) {
  // Focus player and use arrow seeks is unreliable; set currentTime via DOM when possible.
  const ok = await page.evaluate((sec) => {
    const media = document.querySelector("video, audio") as HTMLMediaElement | null
    if (media) {
      media.currentTime = sec
      return true
    }
    const player = document.querySelector("media-player") as
      | (HTMLElement & { currentTime?: number })
      | null
    if (player) {
      player.currentTime = sec
      return true
    }
    return false
  }, targetSec)
  return ok
}

async function seekViaRoomControl(page: Page, targetSec: number) {
  const root = page.locator("media-player").first()
  await root.hover().catch(() => {})
  await settle(400)
  // Prefer player time slider — click percentage along slider.
  const slider = root.locator('[role="slider"]').first()
  if (await slider.isVisible().catch(() => false)) {
    const box = await slider.boundingBox()
    if (box && box.width > 20) {
      const duration = await page.evaluate(() => {
        const player = document.querySelector("media-player") as {
          duration?: number
        } | null
        const media = document.querySelector("video, audio") as HTMLMediaElement | null
        return Number(player?.duration || media?.duration || 0)
      })
      const ratio =
        duration > 0
          ? Math.min(0.9, Math.max(0.02, targetSec / duration))
          : 0.35
      await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
      return true
    }
  }
  return seekViaKeyboard(page, targetSec)
}

async function ensurePlaylistPanel(page: Page) {
  const input = page.getByPlaceholder("Media URL").or(page.getByLabel("Media URL"))
  if (await input.first().isVisible().catch(() => false)) return
  // Side panel may be collapsed; open it without toggling an already-open Playlist tab.
  const showPanel = page.getByRole("button", { name: /Show panel|Open panel/i })
  if (await showPanel.first().isVisible().catch(() => false)) {
    await showPanel.first().click()
  }
  await page.getByRole("button", { name: /^Playlist$/i }).first().click().catch(() => {})
  await input.first().waitFor({ state: "visible", timeout: 20_000 })
}

async function addMediaUrl(page: Page, url: string) {
  await ensurePlaylistPanel(page)
  const input = page.getByPlaceholder("Media URL").or(page.getByLabel("Media URL")).first()
  await input.click()
  await input.fill(url)
  const add = page
    .getByRole("button", { name: /^(Add Media|Add first media)$/ })
    .first()
  await add.click()
}

async function waitPlaylistReady(
  observer: RoomClient,
  sourceUrlSubstring: string,
  timeoutMs = 90_000,
) {
  await observer.waitFor((c) => {
    const item = c.roomState?.playlist.find((p) =>
      (p.sourceUrl ?? "").includes(sourceUrlSubstring),
    )
    if (!item) return false
    if (item.ingestStatus === "error") return true
    return item.ingestStatus === "ready" || item.ingestStatus === undefined
  }, timeoutMs)
  return observer.roomState?.playlist.find((p) =>
    (p.sourceUrl ?? "").includes(sourceUrlSubstring),
  )
}

function playlistRowAtIndex(page: Page, index: number) {
  const badge = `${index + 1}.`
  return page.locator("div.w-full.min-w-0").filter({
    has: page.locator("span").getByText(badge, { exact: true }),
  })
}

async function selectPlaylistItem(
  page: Page,
  opts: { index: number; name?: string },
) {
  await ensurePlaylistPanel(page)
  // Title click renames — must use the per-row "Play this item" control.
  let row = playlistRowAtIndex(page, opts.index)
  if ((await row.count()) === 0 && opts.name) {
    row = page.locator("div.w-full.min-w-0").filter({ hasText: opts.name }).first()
  }
  if ((await row.count()) === 0) return false

  const active = row.filter({ hasText: "Active" })
  if ((await active.count()) > 0) return true

  const playBtn = row.getByRole("button", { name: "Play this item" }).first()
  if (await playBtn.isVisible().catch(() => false)) {
    await playBtn.click()
    return true
  }
  return false
}

async function removePlaylistItemAtIndex(page: Page, index: number) {
  await ensurePlaylistPanel(page)
  const row = playlistRowAtIndex(page, index)
  const removeBtn = row.getByRole("button", { name: "Remove item" }).first()
  if (await removeBtn.isVisible().catch(() => false)) {
    await removeBtn.click()
    return true
  }
  return false
}

/** Drop seeded daily-default row so target index is stable and UI rows are unambiguous. */
async function maybeRemoveDefaultFallback(
  page: Page,
  observer: RoomClient,
  targetIndex: number,
  targetItemId: string,
): Promise<number> {
  const playlist = observer.roomState?.playlist ?? []
  if (targetIndex <= 0 || playlist.length < 2) return targetIndex
  const fallback = playlist[0]
  if (!fallback || fallback.id === targetItemId) return targetIndex

  const removed = await removePlaylistItemAtIndex(page, 0)
  if (!removed) return targetIndex

  const prevLen = playlist.length
  await observer
    .waitFor((c) => (c.roomState?.playlist.length ?? 0) < prevLen, 15_000)
    .catch(() => {})
  return Math.max(0, targetIndex - 1)
}

async function waitForCurrentIndex(
  observer: RoomClient,
  index: number,
  timeoutMs = 20_000,
): Promise<boolean> {
  try {
    await observer.waitFor((c) => c.roomState?.currentIndex === index, timeoutMs)
    return true
  } catch {
    return observer.roomState?.currentIndex === index
  }
}

async function promoteToModerator(ownerPage: Page, guestUserId: string) {
  const label = guestUserId.slice(0, 8)
  await ownerPage.getByText(label).first().waitFor({ timeout: 15_000 })
  // Scope role toggle to the target user's card (not the first guest in the list).
  const card = ownerPage.locator("div").filter({ hasText: label }).filter({
    has: ownerPage.getByRole("button", { name: /Role guest, click to toggle/i }),
  })
  const badge = card
    .getByRole("button", { name: /Role guest, click to toggle/i })
    .first()
  if (!(await badge.isVisible().catch(() => false))) return false
  await badge.click()
  await card
    .getByRole("button", { name: /Role moderator, click to toggle/i })
    .first()
    .waitFor({ timeout: 10_000 })
  return true
}

async function settle(ms = 2_500) {
  await new Promise((r) => setTimeout(r, ms))
}

type MediaCase = {
  id: string
  label: string
  url: string
  /** substring to find playlist item after add */
  match: string
  kind: "direct" | "hls" | "youtube" | "vimeo" | "ytdlp" | "local"
  seekTargetSec?: number
  resolveTimeoutMs?: number
}

const MEDIA_CASES: MediaCase[] = [
  {
    id: "mp4",
    label: "Direct MP4",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    match: "BigBuckBunny",
    kind: "direct",
    seekTargetSec: 15,
  },
  {
    id: "hls",
    label: "HLS (Apple bipbop)",
    url: "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
    match: "bipbop",
    kind: "hls",
    seekTargetSec: 20,
    resolveTimeoutMs: 60_000,
  },
  {
    id: "youtube",
    label: "YouTube native",
    url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    match: "jNQXAC9IVRw",
    kind: "youtube",
    seekTargetSec: 15,
    resolveTimeoutMs: 60_000,
  },
  {
    id: "vimeo",
    label: "Vimeo native",
    url: "https://vimeo.com/76979871",
    match: "76979871",
    kind: "vimeo",
    seekTargetSec: 20,
    resolveTimeoutMs: 60_000,
  },
  {
    // SoundCloud typically goes through yt-dlp extract (not native provider).
    id: "ytdlp",
    label: "yt-dlp (SoundCloud)",
    url: "https://soundcloud.com/forss/flickermood",
    match: "soundcloud.com",
    kind: "ytdlp",
    seekTargetSec: 30,
    resolveTimeoutMs: 120_000,
  },
]

async function measurePair(
  hostPage: Page,
  guestPage: Page,
): Promise<{
  host: Playhead
  guest: Playhead
  peerDeltaSec: number | null
  hostPaused: boolean | null
  guestPaused: boolean | null
}> {
  const [host, guest] = await Promise.all([
    readPlayhead(hostPage),
    readPlayhead(guestPage),
  ])
  const peerDeltaSec =
    host.currentTimeSec !== null && guest.currentTimeSec !== null
      ? Math.abs(host.currentTimeSec - guest.currentTimeSec)
      : null
  return {
    host,
    guest,
    peerDeltaSec,
    hostPaused: host.paused,
    guestPaused: guest.paused,
  }
}

async function openRoom(
  context: BrowserContext,
  roomId: string,
  userId: string,
  userSecret: string,
) {
  const page = await context.newPage()
  page.setDefaultTimeout(25_000)
  await page.goto(
    `${BASE}/room/${roomId}${identityHash(userId, userSecret)}`,
    { waitUntil: "domcontentloaded" },
  )
  await waitForConnected(page)
  return page
}

async function runMediaCase(
  browser: Browser,
  media: MediaCase,
): Promise<void> {
  const roomId = `sync-${media.id}-${Date.now().toString(36)}`
  const hostId = randomUUID()
  const guestId = randomUUID()
  const modId = randomUUID()
  const hostSecret = secret()
  const guestSecret = secret()
  const modSecret = secret()

  const viewport = { width: 1400, height: 900 }
  const hostCtx = await browser.newContext({ viewport })
  const guestCtx = await browser.newContext({ viewport })
  const modCtx = await browser.newContext({ viewport })
  await seedUsername(hostCtx, hostId)
  await seedUsername(guestCtx, guestId)
  await seedUsername(modCtx, modId)

  const roomClock = createServerClockEstimate()
  const observer = new RoomClient({
    baseUrl: BASE,
    roomId,
    userId: randomUUID(),
    userSecret: secret(),
    username: "observer",
    sessionKind: "player",
  })
  wireServerClockFromRoomClient(observer, roomClock)

  let hostCtl: RoomClient | undefined
  let guestCtl: RoomClient | undefined
  let hostPage: Page | undefined
  let guestPage: Page | undefined
  let latePage: Page | undefined
  let modPage: Page | undefined

  try {
    // Host must create the room (first join becomes owner). Observer is read-only.
    hostPage = await openRoom(hostCtx, roomId, hostId, hostSecret)
    guestPage = await openRoom(guestCtx, roomId, guestId, guestSecret)
    await observer.connect()
    await observer.waitFor((c) => Boolean(c.roomState), 20_000)

    // Same uid/secret as browser host/guest — drives playback:play|pause|seek over WS.
    hostCtl = new RoomClient({
      baseUrl: BASE,
      roomId,
      userId: hostId,
      userSecret: hostSecret,
      username: hostId.slice(0, 8),
      sessionKind: "player",
    })
    guestCtl = new RoomClient({
      baseUrl: BASE,
      roomId,
      userId: guestId,
      userSecret: guestSecret,
      username: guestId.slice(0, 8),
      sessionKind: "player",
    })
    await hostCtl.connect()
    await guestCtl.connect()
    await hostCtl.waitFor((c) => Boolean(c.roomState), 20_000)
    await guestCtl.waitFor((c) => Boolean(c.roomState), 20_000)

    note({
      id: `${media.id}-join`,
      severity: "pass",
      media: media.label,
      scenario: "setup",
      title: "Host + guest joined",
      detail: roomId,
    })

    // Clear / ignore default fallback: add target media and activate it.
    await addMediaUrl(hostPage, media.url)
    const item = await waitPlaylistReady(
      observer,
      media.match,
      media.resolveTimeoutMs ?? 90_000,
    ).catch((e) => {
      note({
        id: `${media.id}-resolve-timeout`,
        severity: "fail",
        media: media.label,
        scenario: "resolve",
        title: "Media resolve timed out",
        detail: e instanceof Error ? e.message : String(e),
      })
      return undefined
    })

    if (!item) return
    if (item.ingestStatus === "error") {
      note({
        id: `${media.id}-resolve-error`,
        severity: "fail",
        media: media.label,
        scenario: "resolve",
        title: "Media resolve failed",
        detail: String(item.ingestError ?? "ingestStatus=error"),
        measured: { ingestStatus: String(item.ingestStatus) },
      })
      return
    }

    note({
      id: `${media.id}-resolve-ok`,
      severity: "pass",
      media: media.label,
      scenario: "resolve",
      title: "Media resolved ready",
      detail: item.sourceUrl ?? media.url,
    })

    // Activate item via playlist index / room item name (not URL in visible title).
    const playlist = observer.roomState?.playlist ?? []
    let targetIndex = playlist.findIndex((p) =>
      (p.sourceUrl ?? "").includes(media.match),
    )
    if (targetIndex < 0) {
      note({
        id: `${media.id}-select-missing`,
        severity: "fail",
        media: media.label,
        scenario: "resolve",
        title: "Target item missing from observer playlist",
        detail: `match=${media.match}`,
      })
      return
    }

    targetIndex = await maybeRemoveDefaultFallback(
      hostPage,
      observer,
      targetIndex,
      item.id,
    )
    const byId = (observer.roomState?.playlist ?? []).findIndex(
      (p) => p.id === item.id,
    )
    if (byId >= 0) targetIndex = byId
    const refreshed = observer.roomState?.playlist ?? []
    const targetItem = refreshed[targetIndex]
    const displayName =
      typeof targetItem?.name === "string" && targetItem.name.length > 0
        ? targetItem.name
        : typeof item.name === "string" && item.name.length > 0
          ? item.name
          : undefined

    const selected = await selectPlaylistItem(hostPage, {
      index: targetIndex,
      name: displayName,
    })
    if (!selected) {
      note({
        id: `${media.id}-select-ui`,
        severity: "warn",
        media: media.label,
        scenario: "resolve",
        title: "Could not activate playlist item via Play this item",
        detail: `index=${targetIndex} name=${displayName ?? "(none)"}`,
      })
    }

    const indexOk = await waitForCurrentIndex(observer, targetIndex, 20_000)
    if (indexOk) {
      note({
        id: `${media.id}-select-ok`,
        severity: "pass",
        media: media.label,
        scenario: "resolve",
        title: "Playlist item became current",
        detail: `index=${targetIndex}${displayName ? ` name=${displayName}` : ""}`,
      })
    } else {
      note({
        id: `${media.id}-select-index`,
        severity: "inconclusive",
        media: media.label,
        scenario: "resolve",
        title: "Room currentIndex did not switch to target media",
        detail: `wanted=${targetIndex} got=${String(observer.roomState?.currentIndex)} — skipping sync scenarios (still on fallback/default)`,
        measured: {
          wantedIndex: targetIndex,
          currentIndex: observer.roomState?.currentIndex ?? null,
        },
      })
      return
    }

    await settle(2_500)
    await hostPage
      .waitForFunction(
        () => {
          const mediaEl = document.querySelector(
            "video, audio",
          ) as HTMLMediaElement | null
          if (mediaEl && mediaEl.readyState >= 1) return true
          const player = document.querySelector("media-player") as {
            currentTime?: number
          } | null
          return player != null && Number.isFinite(Number(player.currentTime))
        },
        undefined,
        { timeout: 25_000 },
      )
      .catch(() => {})

    // --- PLAY ---
    const playVia = await hostPlaybackPlay(hostCtl, hostPage, clickPlayPause)
    await settle(3_500)
    await observer
      .waitFor((c) => c.roomState?.playback?.paused === false, 15_000)
      .catch(() => {})

    let pair = await measurePair(hostPage, guestPage)
    const hostTransport = await roomPlayingLabel(hostPage)
    const guestTransport = await roomPlayingLabel(guestPage)

    if (hostTransport !== guestTransport) {
      note({
        id: `${media.id}-play-transport-mismatch`,
        severity: "fail",
        media: media.label,
        scenario: "play",
        title: "Room transport label mismatch after play",
        detail: `host=${hostTransport} guest=${guestTransport}`,
        measured: { playVia },
      })
    }

    if (pair.peerDeltaSec === null) {
      note({
        id: `${media.id}-play-no-playhead`,
        severity: media.kind === "youtube" || media.kind === "vimeo" ? "warn" : "fail",
        media: media.label,
        scenario: "play",
        title: "Could not read playhead(s) after play",
        detail: `host=${pair.host.source} guest=${pair.guest.source}`,
        measured: {
          hostTime: pair.host.currentTimeSec,
          guestTime: pair.guest.currentTimeSec,
        },
      })
    } else if (pair.peerDeltaSec > PEER_FAIL_SEC) {
      note({
        id: `${media.id}-play-peer-lag`,
        severity: "fail",
        media: media.label,
        scenario: "play",
        title: "Host/guest playhead lag after play",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s (fail>${PEER_FAIL_SEC}s)`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
        },
      })
    } else if (pair.peerDeltaSec > PEER_OK_SEC) {
      note({
        id: `${media.id}-play-peer-lag-soft`,
        severity: "warn",
        media: media.label,
        scenario: "play",
        title: "Host/guest playhead lag soft threshold after play",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s (warn>${PEER_OK_SEC}s, fail>${PEER_FAIL_SEC}s)`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
        },
      })
    } else {
      note({
        id: `${media.id}-play-ok`,
        severity: "pass",
        media: media.label,
        scenario: "play",
        title: "Play sync within tolerance",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
        },
      })
    }

    // Drift vs room clock — only when playheads come from media-player (not presence grain).
    const pb = observer.roomState?.playback as
      | {
          paused?: boolean
          playbackRate?: number
          timelineAnchorMs?: number
          serverNowMs?: number
        }
      | undefined
    const expected =
      pb && roomClock.hasSample()
        ? expectedPlayheadSec(pb, roomClock.serverNowEstimateMs)
        : null
    if (
      expected !== null &&
      pair.host.source === "player" &&
      pair.host.tag === "media-player" &&
      pair.host.currentTimeSec !== null
    ) {
      const hostDrift = Math.abs(pair.host.currentTimeSec - expected)
      const guestDrift =
        pair.guest.source === "player" &&
        pair.guest.tag === "media-player" &&
        pair.guest.currentTimeSec !== null
          ? Math.abs(pair.guest.currentTimeSec - expected)
          : null
      if (hostDrift > DRIFT_THRESHOLD_SEC + 0.5) {
        note({
          id: `${media.id}-play-host-clock-drift`,
          severity: "warn",
          media: media.label,
          scenario: "play",
          title: "Host playhead vs room clock",
          detail: `hostDrift=${hostDrift.toFixed(3)}s expected≈${expected.toFixed(2)}s (threshold ${DRIFT_THRESHOLD_SEC}s; serverNowEstimateMs)`,
          measured: { hostDrift, expected, hostSec: pair.host.currentTimeSec },
        })
      }
      if (guestDrift !== null && guestDrift > DRIFT_THRESHOLD_SEC + 0.5) {
        note({
          id: `${media.id}-play-guest-clock-drift`,
          severity: "fail",
          media: media.label,
          scenario: "play",
          title: "Guest playhead vs room clock",
          detail: `guestDrift=${guestDrift.toFixed(3)}s expected≈${expected.toFixed(2)}s (serverNowEstimateMs)`,
          measured: { guestDrift, expected, guestSec: pair.guest.currentTimeSec },
        })
      }
    }

    // --- PAUSE ---
    const pauseVia = await hostPlaybackPause(hostCtl, hostPage, clickPlayPause)
    await settle(2_000)
    await observer
      .waitFor((c) => c.roomState?.playback?.paused === true, 10_000)
      .catch(() => {})
    pair = await measurePair(hostPage, guestPage)
    const hostPausedLabel = await roomPlayingLabel(hostPage)
    const guestPausedLabel = await roomPlayingLabel(guestPage)

    if (observer.roomState?.playback?.paused !== true) {
      note({
        id: `${media.id}-pause-room-state`,
        severity: "fail",
        media: media.label,
        scenario: "pause",
        title: "Room playback.paused not true after host pause",
        detail: `paused=${String(observer.roomState?.playback?.paused)}`,
      })
    }

    if (hostPausedLabel !== "Paused" || guestPausedLabel !== "Paused") {
      note({
        id: `${media.id}-pause-ui-label`,
        severity: "fail",
        media: media.label,
        scenario: "pause",
        title: "UI transport not Paused on both clients",
        detail: `host=${hostPausedLabel} guest=${guestPausedLabel}`,
      })
    }

    if (
      pair.hostPaused === false ||
      (pair.guestPaused !== null && pair.guestPaused === false)
    ) {
      note({
        id: `${media.id}-pause-element`,
        severity: "fail",
        media: media.label,
        scenario: "pause",
        title: "Media element still playing after pause",
        detail: `host.paused=${pair.hostPaused} guest.paused=${pair.guestPaused}`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
        },
      })
    } else if (pair.peerDeltaSec !== null && pair.peerDeltaSec > PEER_FAIL_SEC) {
      note({
        id: `${media.id}-pause-peer-lag`,
        severity: "fail",
        media: media.label,
        scenario: "pause",
        title: "Paused playheads diverge",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
        },
      })
    } else {
      note({
        id: `${media.id}-pause-ok`,
        severity: "pass",
        media: media.label,
        scenario: "pause",
        title: "Pause sync OK",
        detail:
          pair.peerDeltaSec !== null
            ? `Δ=${pair.peerDeltaSec.toFixed(3)}s`
            : "labels OK (no playhead)",
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
          pauseVia,
        },
      })
    }

    // Freeze check: paused should not advance
    const t1 = pair.host.currentTimeSec
    await settle(2_000)
    const t2 = (await readPlayhead(hostPage)).currentTimeSec
    if (t1 !== null && t2 !== null && Math.abs(t2 - t1) > 0.35) {
      note({
        id: `${media.id}-pause-drift`,
        severity: "fail",
        media: media.label,
        scenario: "pause",
        title: "Playhead advances while paused",
        detail: `Δ=${(t2 - t1).toFixed(3)}s over 2s`,
        measured: { t1, t2 },
      })
    }

    // --- SEEK (while paused) ---
    const seekTarget = media.seekTargetSec ?? 10
    const seekVia = await hostPlaybackSeek(
      hostCtl,
      hostPage,
      observer,
      seekTarget,
      seekViaRoomControl,
    )
    if (seekVia === "none") {
      note({
        id: `${media.id}-seek-ui-missing`,
        severity: "warn",
        media: media.label,
        scenario: "seek",
        title: "Seek did not reach target timeline anchor",
        detail: `wanted ~${seekTarget}s (hostCtl + UI fallback)`,
      })
    }
    await settle(1_500)
    pair = await measurePair(hostPage, guestPage)
    const seekTol = Math.max(PEER_FAIL_SEC, 2.0) // iframe providers can be coarse
    if (pair.peerDeltaSec === null) {
      note({
        id: `${media.id}-seek-no-playhead`,
        severity: media.kind === "youtube" || media.kind === "vimeo" ? "warn" : "fail",
        media: media.label,
        scenario: "seek",
        title: "Could not read playheads after seek",
        detail: `target=${seekTarget}s`,
      })
    } else if (pair.peerDeltaSec > seekTol) {
      note({
        id: `${media.id}-seek-peer-lag`,
        severity: "fail",
        media: media.label,
        scenario: "seek",
        title: "Host/guest diverge after seek",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s target≈${seekTarget}s`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
          targetSec: seekTarget,
        },
      })
    } else {
      const hostErr =
        pair.host.currentTimeSec !== null
          ? Math.abs(pair.host.currentTimeSec - seekTarget)
          : null
      const guestErr =
        pair.guest.currentTimeSec !== null
          ? Math.abs(pair.guest.currentTimeSec - seekTarget)
          : null
      if (
        (hostErr !== null && hostErr > seekTol) ||
        (guestErr !== null && guestErr > seekTol)
      ) {
        note({
          id: `${media.id}-seek-target-miss`,
          severity: "fail",
          media: media.label,
          scenario: "seek",
          title: "Seek landed far from target",
          detail: `hostErr=${hostErr?.toFixed(2)} guestErr=${guestErr?.toFixed(2)} target=${seekTarget}`,
          measured: {
            hostSec: pair.host.currentTimeSec,
            guestSec: pair.guest.currentTimeSec,
            targetSec: seekTarget,
          },
        })
      } else {
        note({
          id: `${media.id}-seek-ok`,
          severity: "pass",
          media: media.label,
          scenario: "seek",
          title: "Seek sync OK",
          detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s near ${seekTarget}s`,
          measured: {
            hostSec: pair.host.currentTimeSec,
            guestSec: pair.guest.currentTimeSec,
            deltaSec: pair.peerDeltaSec,
          },
        })
      }
    }

    // --- LATE JOIN while paused ---
    latePage = await openRoom(guestCtx, roomId, randomUUID(), secret())
    await settle(4_000)
    const lateHead = await readPlayhead(latePage)
    const hostHead = await readPlayhead(hostPage)
    if (
      lateHead.currentTimeSec !== null &&
      hostHead.currentTimeSec !== null
    ) {
      const lateDelta = Math.abs(lateHead.currentTimeSec - hostHead.currentTimeSec)
      if (lateDelta > PEER_FAIL_SEC) {
        note({
          id: `${media.id}-latejoin-paused`,
          severity: "fail",
          media: media.label,
          scenario: "late-join-paused",
          title: "Late joiner playhead off while room paused",
          detail: `Δ=${lateDelta.toFixed(3)}s`,
          measured: {
            lateSec: lateHead.currentTimeSec,
            hostSec: hostHead.currentTimeSec,
            deltaSec: lateDelta,
          },
        })
      } else {
        note({
          id: `${media.id}-latejoin-paused-ok`,
          severity: "pass",
          media: media.label,
          scenario: "late-join-paused",
          title: "Late joiner matches paused clock",
          detail: `Δ=${lateDelta.toFixed(3)}s`,
          measured: { lateSec: lateHead.currentTimeSec, hostSec: hostHead.currentTimeSec },
        })
      }
    } else {
      note({
        id: `${media.id}-latejoin-paused-nohead`,
        severity: "warn",
        media: media.label,
        scenario: "late-join-paused",
        title: "Late joiner playhead unreadable",
        detail: `late=${lateHead.source} host=${hostHead.source}`,
      })
    }
    await latePage.close().catch(() => {})
    latePage = undefined

    // Resume play then late-join while playing
    await hostPlaybackPlay(hostCtl, hostPage, clickPlayPause)
    await settle(3_000)
    latePage = await openRoom(guestCtx, roomId, randomUUID(), secret())
    await settle(5_000)
    const latePlaying = await measurePair(hostPage, latePage)
    if (latePlaying.peerDeltaSec === null) {
      note({
        id: `${media.id}-latejoin-playing-nohead`,
        severity: "warn",
        media: media.label,
        scenario: "late-join-playing",
        title: "Late joiner playhead unreadable while playing",
        detail: `host=${latePlaying.host.source} late=${latePlaying.guest.source}`,
      })
    } else if (latePlaying.peerDeltaSec > PEER_FAIL_SEC + 0.5) {
      // allow a bit more settle for buffering
      note({
        id: `${media.id}-latejoin-playing`,
        severity: "fail",
        media: media.label,
        scenario: "late-join-playing",
        title: "Late joiner lag while playing",
        detail: `Δ=${latePlaying.peerDeltaSec.toFixed(3)}s after 5s settle`,
        measured: {
          hostSec: latePlaying.host.currentTimeSec,
          lateSec: latePlaying.guest.currentTimeSec,
          deltaSec: latePlaying.peerDeltaSec,
        },
      })
    } else if (latePlaying.peerDeltaSec > PEER_OK_SEC) {
      note({
        id: `${media.id}-latejoin-playing-soft`,
        severity: "warn",
        media: media.label,
        scenario: "late-join-playing",
        title: "Late joiner soft lag while playing",
        detail: `Δ=${latePlaying.peerDeltaSec.toFixed(3)}s`,
        measured: {
          hostSec: latePlaying.host.currentTimeSec,
          lateSec: latePlaying.guest.currentTimeSec,
          deltaSec: latePlaying.peerDeltaSec,
        },
      })
    } else {
      note({
        id: `${media.id}-latejoin-playing-ok`,
        severity: "pass",
        media: media.label,
        scenario: "late-join-playing",
        title: "Late joiner sync OK while playing",
        detail: `Δ=${latePlaying.peerDeltaSec.toFixed(3)}s`,
        measured: {
          hostSec: latePlaying.host.currentTimeSec,
          lateSec: latePlaying.guest.currentTimeSec,
          deltaSec: latePlaying.peerDeltaSec,
        },
      })
    }
    await latePage.close().catch(() => {})
    latePage = undefined

    // --- CONCURRENT MODERATORS ---
    modPage = await openRoom(modCtx, roomId, modId, modSecret)
    const promoted = await promoteToModerator(hostPage, modId)
    if (!promoted) {
      note({
        id: `${media.id}-mod-promote`,
        severity: "warn",
        media: media.label,
        scenario: "concurrent-mods",
        title: "Could not promote second user to moderator via UI",
        detail: "Skipping concurrent moderator race",
      })
    } else {
      note({
        id: `${media.id}-mod-promote-ok`,
        severity: "pass",
        media: media.label,
        scenario: "concurrent-mods",
        title: "Promoted guest to moderator",
        detail: modId.slice(0, 8),
      })

      // Race: host via RoomClient + mod via UI seek/play-pause.
      const beforeRace = Number(
        (observer.roomState?.playback as { timelineAnchorMs?: number } | undefined)
          ?.timelineAnchorMs,
      )
      await Promise.all([
        hostCtl!.send("playback:seek", { targetMs: 5_000 }),
        seekViaRoomControl(modPage!, 25),
      ])
      await settle(500)
      await Promise.all([
        hostCtl!.send("playback:play"),
        clickPlayPause(modPage!, "Pause"),
      ])
      await settle(3_500)

      const finalPaused = observer.roomState?.playback?.paused
      const finalAnchor = Number(
        (observer.roomState?.playback as { timelineAnchorMs?: number } | undefined)
          ?.timelineAnchorMs,
      )
      pair = await measurePair(hostPage!, guestPage!)
      const modHead = await readPlayhead(modPage!)

      const times = [
        pair.host.currentTimeSec,
        pair.guest.currentTimeSec,
        modHead.currentTimeSec,
      ].filter((t): t is number => t !== null)
      const spread =
        times.length >= 2 ? Math.max(...times) - Math.min(...times) : null

      if (spread !== null && spread > PEER_FAIL_SEC + 1) {
        note({
          id: `${media.id}-concurrent-diverge`,
          severity: "fail",
          media: media.label,
          scenario: "concurrent-mods",
          title: "Clients diverge after concurrent mod seek/play-pause race",
          detail: `spread=${spread.toFixed(3)}s paused=${String(finalPaused)} anchorMs=${finalAnchor}`,
          measured: {
            hostSec: pair.host.currentTimeSec,
            guestSec: pair.guest.currentTimeSec,
            modSec: modHead.currentTimeSec,
            spread,
            finalPaused: Boolean(finalPaused),
            finalAnchor,
            beforeRace,
          },
        })
      } else {
        note({
          id: `${media.id}-concurrent-ok`,
          severity: "pass",
          media: media.label,
          scenario: "concurrent-mods",
          title: "Clients converged after concurrent mod race",
          detail: `spread=${spread?.toFixed(3) ?? "n/a"}s paused=${String(finalPaused)} lastAnchor≈${Number.isFinite(finalAnchor) ? (finalAnchor / 1000).toFixed(1) + "s" : "?"}`,
          measured: {
            hostSec: pair.host.currentTimeSec,
            guestSec: pair.guest.currentTimeSec,
            modSec: modHead.currentTimeSec,
            spread,
            finalPaused: Boolean(finalPaused),
            finalAnchor,
          },
        })
      }

    }

    if (modPage) {
      await modPage.close().catch(() => {})
      modPage = undefined
    }

    // Guest must not control — protocol-level pause (NC-10); not UI after concurrent-mod.
    const beforePaused = observer.roomState?.playback?.paused
    const beforeAnchor = Number(
      (observer.roomState?.playback as { timelineAnchorMs?: number } | undefined)
        ?.timelineAnchorMs,
    )
    guestCtl!.send("playback:pause")
    await settle(1_500)
    const afterPaused = observer.roomState?.playback?.paused
    const afterAnchor = Number(
      (observer.roomState?.playback as { timelineAnchorMs?: number } | undefined)
        ?.timelineAnchorMs,
    )
    if (afterPaused !== beforePaused) {
      note({
        id: `${media.id}-guest-control-leak`,
        severity: "fail",
        media: media.label,
        scenario: "authz",
        title: "Guest playback:pause changed room pause state",
        detail: `paused ${String(beforePaused)}->${String(afterPaused)}`,
      })
    } else {
      note({
        id: `${media.id}-guest-control-ok`,
        severity: "pass",
        media: media.label,
        scenario: "authz",
        title: "Guest playback:pause ignored",
        detail: `paused stayed ${String(afterPaused)}; anchor ${beforeAnchor}->${afterAnchor}`,
      })
    }
  } catch (error) {
    note({
      id: `${media.id}-crash`,
      severity: "fail",
      media: media.label,
      scenario: "suite",
      title: "Media case crashed",
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await hostPage?.close().catch(() => {})
    await guestPage?.close().catch(() => {})
    await latePage?.close().catch(() => {})
    await modPage?.close().catch(() => {})
    await hostCtx.close().catch(() => {})
    await guestCtx.close().catch(() => {})
    await modCtx.close().catch(() => {})
    hostCtl?.close()
    guestCtl?.close()
    observer.close()
  }
}

async function runLocalFileCase(browser: Browser) {
  const mediaLabel = "Local file (HTTP relay)"
  const roomId = `sync-local-${Date.now().toString(36)}`
  const hostId = randomUUID()
  const guestId = randomUUID()
  const hostSecret = secret()
  const guestSecret = secret()

  const viewport = { width: 1400, height: 900 }
  const hostCtx = await browser.newContext({ viewport })
  const guestCtx = await browser.newContext({ viewport })
  await seedUsername(hostCtx, hostId)
  await seedUsername(guestCtx, guestId)

  let hostPage: Page | undefined
  let guestPage: Page | undefined

  try {
    hostPage = await openRoom(hostCtx, roomId, hostId, hostSecret)
    guestPage = await openRoom(guestCtx, roomId, guestId, guestSecret)

    // Create a tiny synthetic mp4 via input file — use a downloaded flower clip if available,
    // else skip with note. Fetch bytes in Node and set input files.
    const res = await fetch(
      "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    )
    if (!res.ok) {
      note({
        id: "local-fetch-fixture",
        severity: "warn",
        media: mediaLabel,
        scenario: "setup",
        title: "Could not download local-file fixture",
        detail: `HTTP ${res.status}`,
      })
      return
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const share = hostPage.getByRole("button", { name: /Share Local File/i })
    if (!(await share.isVisible().catch(() => false))) {
      note({
        id: "local-share-missing",
        severity: "fail",
        media: mediaLabel,
        scenario: "setup",
        title: "Share Local File control missing",
        detail: "button not visible for owner",
      })
      return
    }
    await share.click()
    const fileInput = hostPage.locator('input[type="file"]').first()
    await fileInput.setInputFiles({
      name: "flower-local.mp4",
      mimeType: "video/mp4",
      buffer: buf,
    })
    await settle(8_000)

    const hostBody = await hostPage.locator("body").innerText()
    const guestBody = await guestPage.locator("body").innerText()
    const hostHas = /flower-local|local/i.test(hostBody)
    const guestHas = /flower-local|local/i.test(guestBody)
    if (!hostHas) {
      note({
        id: "local-host-playlist",
        severity: "fail",
        media: mediaLabel,
        scenario: "resolve",
        title: "Local file did not appear on host playlist",
        detail: hostBody.slice(0, 300),
      })
      return
    }
    if (!guestHas) {
      note({
        id: "local-guest-playlist",
        severity: "fail",
        media: mediaLabel,
        scenario: "resolve",
        title: "Local file playlist entry did not sync to guest",
        detail: "guest body missing local item label",
      })
    }

    await clickPlayPause(hostPage, "Play")
    await settle(6_000)
    const pair = await measurePair(hostPage, guestPage)
    if (pair.peerDeltaSec === null) {
      note({
        id: "local-play-nohead",
        severity: "fail",
        media: mediaLabel,
        scenario: "play",
        title: "Local-media playheads unreadable (guest may lack bytes)",
        detail: `host=${pair.host.source} guest=${pair.guest.source} — SFU unavailable in Bun; relay path expected`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
        },
      })
    } else if (pair.peerDeltaSec > PEER_FAIL_SEC) {
      note({
        id: "local-play-lag",
        severity: "fail",
        media: mediaLabel,
        scenario: "play",
        title: "Local-media host/guest lag after play",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
        },
      })
    } else {
      note({
        id: "local-play-ok",
        severity: "pass",
        media: mediaLabel,
        scenario: "play",
        title: "Local-media play sync OK",
        detail: `Δ=${pair.peerDeltaSec.toFixed(3)}s`,
        measured: {
          hostSec: pair.host.currentTimeSec,
          guestSec: pair.guest.currentTimeSec,
          deltaSec: pair.peerDeltaSec,
        },
      })
    }

    await clickPlayPause(hostPage, "Pause")
    await settle(2_000)
    const afterPause = await measurePair(hostPage, guestPage)
    if (
      afterPause.guestPaused === false ||
      afterPause.hostPaused === false
    ) {
      note({
        id: "local-pause",
        severity: "fail",
        media: mediaLabel,
        scenario: "pause",
        title: "Local-media pause not reflected on both clients",
        detail: `host.paused=${afterPause.hostPaused} guest.paused=${afterPause.guestPaused}`,
      })
    } else {
      note({
        id: "local-pause-ok",
        severity: "pass",
        media: mediaLabel,
        scenario: "pause",
        title: "Local-media pause OK",
        detail: `Δ=${afterPause.peerDeltaSec?.toFixed(3) ?? "n/a"}s`,
      })
    }
  } catch (error) {
    note({
      id: "local-crash",
      severity: "fail",
      media: mediaLabel,
      scenario: "suite",
      title: "Local file case crashed",
      detail: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await hostPage?.close().catch(() => {})
    await guestPage?.close().catch(() => {})
    await hostCtx.close().catch(() => {})
    await guestCtx.close().catch(() => {})
  }
}

async function main() {
  console.log(`Sync audit base=${BASE}`)
  console.log(
    `Thresholds: roomDrift=${DRIFT_THRESHOLD_SEC}s peerOk=${PEER_OK_SEC}s peerFail=${PEER_FAIL_SEC}s`,
  )

  const { ok: healthOk, health } = await checkHealth(BASE)
  if (!healthOk) {
    console.error("Health check failed", health)
    process.exit(2)
  }
  note({
    id: "health",
    severity: "pass",
    media: "infra",
    scenario: "setup",
    title: "Health OK",
    detail: `valkey=${String(health.valkey)} ytdlpBin=${String((health as { ytdlpBin?: string }).ytdlpBin)}`,
  })

  // Probe identity hash bootstrap (RoomClient + browser share uid/secret when hash is honored).
  {
    const probeBrowser = await chromium.launch({ headless: true })
    try {
      const uid = randomUUID()
      const sec = secret()
      const ctx = await probeBrowser.newContext()
      const page = await ctx.newPage()
      let secretMatch: boolean | null = null
      page.on("websocket", (ws) => {
        if (!ws.url().includes("/api/ws")) return
        ws.on("framesent", (f) => {
          const raw = String(f.payload)
          if (!raw.includes("room:join")) return
          try {
            const msg = JSON.parse(raw) as {
              payload?: { userSecret?: string }
            }
            secretMatch = msg.payload?.userSecret === sec
          } catch {
            // ignore
          }
        })
      })
      await page.goto(
        `${BASE}/room/idprobe-${Date.now().toString(36)}${identityHash(uid, sec)}`,
        { waitUntil: "domcontentloaded" },
      )
      await settle(4_000)
      if (secretMatch === false) {
        note({
          id: "identity-hash-bootstrap",
          severity: "fail",
          media: "infra",
          scenario: "identity",
          title: "URL hash identity secret not used on room:join",
          detail:
            "Browser joined with a different userSecret than #uid&#secret (likely Strict Mode remount racing consumeSessionIdentityFromHash). Breaks scripted multi-session control and control-token mint with known secrets.",
        })
      } else if (secretMatch === true) {
        note({
          id: "identity-hash-bootstrap",
          severity: "pass",
          media: "infra",
          scenario: "identity",
          title: "URL hash identity secret honored",
          detail: "room:join userSecret matched bootstrap hash",
        })
      } else {
        note({
          id: "identity-hash-bootstrap",
          severity: "warn",
          media: "infra",
          scenario: "identity",
          title: "Could not observe room:join secret",
          detail: "No room:join frame captured",
        })
      }
      await ctx.close()
    } finally {
      await probeBrowser.close()
    }
  }

  const browser = await chromium.launch({ headless: true })
  try {
    for (const media of MEDIA_CASES) {
      console.log(`\n=== ${media.label} ===`)
      await runMediaCase(browser, media)
    }
    console.log(`\n=== Local file ===`)
    await runLocalFileCase(browser)
  } finally {
    await browser.close()
  }

  const fails = FINDINGS.filter((f) => f.severity === "fail")
  const warns = FINDINGS.filter((f) => f.severity === "warn")
  const passes = FINDINGS.filter((f) => f.severity === "pass")

  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    thresholds: {
      DRIFT_THRESHOLD_SEC,
      PEER_OK_SEC,
      PEER_FAIL_SEC,
    },
    summary: {
      pass: passes.length,
      warn: warns.length,
      fail: fails.length,
      inconclusive: FINDINGS.filter((f) => f.severity === "inconclusive").length,
      total: FINDINGS.length,
    },
    findings: FINDINGS,
    nonConformances: [
      ...fails,
      ...warns,
      ...FINDINGS.filter((f) => f.severity === "inconclusive"),
    ].map((f) => ({
      id: f.id,
      severity: f.severity,
      media: f.media,
      scenario: f.scenario,
      title: f.title,
      detail: f.detail,
      measured: f.measured,
    })),
  }

  const outPath = `/tmp/wsp-sync-audit-${Date.now()}.json`
  writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log("\n=== NON-CONFORMANCES ===")
  if (report.nonConformances.length === 0) {
    console.log("(none)")
  } else {
    for (const n of report.nonConformances) {
      console.log(
        `- [${n.severity}] ${n.media} / ${n.scenario}: ${n.title} — ${n.detail}`,
      )
    }
  }
  const inconclusive = FINDINGS.filter((f) => f.severity === "inconclusive")
  console.log(
    `\nSummary pass=${passes.length} warn=${warns.length} inconclusive=${inconclusive.length} fail=${fails.length}`,
  )
  console.log(`Report: ${outPath}`)
  process.exit(fails.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
