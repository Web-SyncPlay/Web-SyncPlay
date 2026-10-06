import { chromium } from "playwright"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.dirname(fileURLToPath(import.meta.url))
const filePath = path.join(root, "..", "tmp", "sfu-test.mp4")
const base = "http://127.0.0.1:3000"
const room = `sfu-pw-${Date.now().toString(36)}`

const browser = await chromium.launch({ headless: true })
const host = await browser.newContext()
const viewer = await browser.newContext()
const hostPage = await host.newPage()
const viewerPage = await viewer.newPage()

const mediaHeaders = []
viewerPage.on("response", (res) => {
  if (!res.url().includes("/api/media/local/")) return
  mediaHeaders.push({
    status: res.status(),
    source: res.headers()["x-local-media-source"] ?? null,
    contentRange: res.headers()["content-range"] ?? null,
    contentType: res.headers()["content-type"] ?? null,
    url: res.url().split("?")[0],
  })
})

const hostLogs = []
hostPage.on("console", (msg) => {
  const text = msg.text()
  if (/sfu|mediasoup|local-media/i.test(text)) hostLogs.push(text)
})
const viewerLogs = []
viewerPage.on("console", (msg) => {
  const text = msg.text()
  if (/sfu|mediasoup|local-media/i.test(text)) viewerLogs.push(text)
})

await hostPage.goto(`${base}/room/${room}`, { waitUntil: "domcontentloaded" })
await hostPage
  .getByRole("button", { name: "Share Local File" })
  .first()
  .waitFor({ timeout: 20_000 })
await hostPage
  .locator('input[type=file][accept*="video"]')
  .first()
  .setInputFiles(filePath)
await hostPage.getByRole("button", { name: "sfu-test.mp4" }).first().waitFor({
  timeout: 20_000,
})
// Select the shared item if it is not current.
const playButtons = hostPage.getByRole("button", { name: "Play this item" })
const playCount = await playButtons.count()
if (playCount > 0) {
  // When fallback + shared exist, play the last (shared) item.
  await playButtons.nth(playCount - 1).click()
}

const hostProviderReady = await hostPage.evaluate(async () => {
  const start = Date.now()
  while (Date.now() - start < 15_000) {
    const session = globalThis.__webSyncPlayLocalMediaSfu
    if (session?.providers?.size) {
      for (const promise of session.providers.values()) {
        const slot = await promise
        if (slot?.producer && !slot.producer.closed) {
          return { ready: true, waitedMs: Date.now() - start }
        }
      }
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  return {
    ready: false,
    waitedMs: 15_000,
    hasSession: Boolean(globalThis.__webSyncPlayLocalMediaSfu),
    providerKeys: [
      ...(globalThis.__webSyncPlayLocalMediaSfu?.providers?.keys?.() ?? []),
    ],
  }
})

await viewerPage.goto(`${base}/room/${room}`, {
  waitUntil: "domcontentloaded",
})

// Wait until SW controls the page and SFU viewer channel is ready (or timeout).
const sfuWarm = await viewerPage.evaluate(async () => {
  const start = Date.now()
  while (Date.now() - start < 20_000) {
    const controlled = Boolean(navigator.serviceWorker?.controller)
    const session = globalThis.__webSyncPlayLocalMediaSfu
    const viewers = session?.viewers
    let ready = false
    if (viewers) {
      for (const promise of viewers.values()) {
        const slot = await promise
        if (slot?.ready) ready = true
      }
    }
    if (controlled && ready) {
      return { controlled, ready, waitedMs: Date.now() - start }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return {
    controlled: Boolean(navigator.serviceWorker?.controller),
    ready: false,
    waitedMs: 20_000,
    hasSession: Boolean(globalThis.__webSyncPlayLocalMediaSfu),
    viewerKeys: [...(globalThis.__webSyncPlayLocalMediaSfu?.viewers?.keys?.() ?? [])],
  }
})

await viewerPage.waitForTimeout(1_000)

const sfuRangeProbe = await viewerPage.evaluate(async () => {
  const video = document.querySelector("video")
  const src = video?.currentSrc || ""
  const match = /\/api\/media\/local\/([^/?#]+)/.exec(src)
  if (!match) return { ok: false, error: "no_local_src", src }
  const res = await fetch(`/api/media/local/${match[1]}`, {
    headers: { Range: "bytes=0-1023" },
  })
  const buf = await res.arrayBuffer()
  return {
    ok: res.ok || res.status === 206,
    status: res.status,
    source: res.headers.get("x-local-media-source"),
    contentRange: res.headers.get("content-range"),
    contentType: res.headers.get("content-type"),
    byteLength: buf.byteLength,
  }
})

const videoState = await viewerPage.evaluate(async () => {
  const video = document.querySelector("video")
  if (!video) return { error: "no_video" }
  const start = Date.now()
  while (Date.now() - start < 25_000) {
    if (
      video.readyState >= 2 &&
      Number.isFinite(video.duration) &&
      video.duration > 0
    ) {
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  try {
    await video.play()
  } catch {
    // autoplay may be blocked; still inspect buffered media
  }
  await new Promise((r) => setTimeout(r, 2_500))
  return {
    currentSrc: video.currentSrc,
    readyState: video.readyState,
    networkState: video.networkState,
    duration: video.duration,
    currentTime: video.currentTime,
    paused: video.paused,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    error: video.error
      ? { code: video.error.code, message: video.error.message }
      : null,
  }
})

const hostSfu = await hostPage.evaluate(() => ({
  hasSession: Boolean(globalThis.__webSyncPlayLocalMediaSfu),
  providerCount: globalThis.__webSyncPlayLocalMediaSfu?.providers?.size ?? null,
}))
const viewerSfu = await viewerPage.evaluate(() => ({
  hasSession: Boolean(globalThis.__webSyncPlayLocalMediaSfu),
  viewerCount: globalThis.__webSyncPlayLocalMediaSfu?.viewers?.size ?? null,
}))

const hostId = await hostPage.evaluate(() =>
  localStorage.getItem("web-syncplay:user-id"),
)
const viewerId = await viewerPage.evaluate(() =>
  localStorage.getItem("web-syncplay:user-id"),
)

const result = {
  room,
  distinctUsers: hostId !== viewerId,
  hostId,
  viewerId,
  sfuWarm,
  hostProviderReady,
  sfuRangeProbe,
  videoState,
  mediaHeaders: mediaHeaders.slice(0, 30),
  sources: [...new Set(mediaHeaders.map((h) => h.source))],
  hostSfu,
  viewerSfu,
  hostLogs: hostLogs.slice(-20),
  viewerLogs: viewerLogs.slice(-20),
}

console.log(JSON.stringify(result, null, 2))

const streamed =
  videoState &&
  videoState.readyState >= 2 &&
  Number.isFinite(videoState.duration) &&
  videoState.duration > 0 &&
  (videoState.videoWidth > 0 || videoState.currentTime > 0)
const sfuBytes =
  sfuRangeProbe?.ok &&
  (sfuRangeProbe.source === "sfu" || sfuRangeProbe.source === "webrtc")

await browser.close()
if (!result.distinctUsers || !streamed) {
  process.exitCode = 1
} else if (!sfuBytes) {
  // Streamed via HTTP relay is still success for "another user can play";
  // mark soft-fail with exit 2 when SFU/WebRTC path did not serve the probe.
  process.exitCode = 2
}
