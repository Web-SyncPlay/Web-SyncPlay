import type { BrowserContext, Page } from "playwright"
import type { RoomClient } from "./room-ws-client.ts"
import {
  createServerClockEstimate,
  expectedPlayheadSec,
  type PlaybackClockFields,
  type ServerClockEstimate,
} from "./server-clock-estimate.ts"

export { createServerClockEstimate, expectedPlayheadSec }
export type { PlaybackClockFields, ServerClockEstimate }

/** True send-time wall stamp — never the frozen playback timeline stamp. */
function wallClockFromEnvelope(msg: {
  type: string
  payload: Record<string, unknown>
}): number | undefined {
  const payload = msg.payload
  if (msg.type === "presence:batch" || msg.type === "session:clock") {
    return typeof payload.serverNowMs === "number"
      ? payload.serverNowMs
      : undefined
  }
  if (
    msg.type === "room:snapshot" ||
    msg.type === "room:state" ||
    msg.type === "room:control"
  ) {
    return typeof payload.serverWallNowMs === "number"
      ? payload.serverWallNowMs
      : undefined
  }
  return undefined
}

/** Feed wall-clock stamps from inbound room envelopes into a clock estimate. */
export function wireServerClockFromRoomClient(
  client: RoomClient,
  clock: ServerClockEstimate,
): void {
  const prev = client.onMessage
  client.onMessage = (msg) => {
    const wall = wallClockFromEnvelope(msg)
    if (typeof wall === "number") {
      clock.observeServerNowMs(wall)
    }
    prev?.(msg)
  }
  const wall = client.roomState?.serverWallNowMs
  if (typeof wall === "number") {
    clock.observeServerNowMs(wall)
  }
}

/**
 * Track the page's `/api/ws` sockets so the harness can inject envelopes on the
 * session that already holds playback control (browser host), instead of a
 * second RoomClient for the same uid (which gets canControlPlayback=false).
 */
export async function installPageRoomWsTracker(
  context: BrowserContext,
): Promise<void> {
  await context.addInitScript(() => {
    type TrackedWindow = Window & {
      __syncAuditRoomSockets?: WebSocket[]
    }
    const w = window as TrackedWindow
    if (w.__syncAuditRoomSockets) return
    const sockets: WebSocket[] = []
    w.__syncAuditRoomSockets = sockets

    const Original = window.WebSocket
    function TrackedWebSocket(
      this: WebSocket,
      url: string | URL,
      protocols?: string | string[],
    ) {
      const ws =
        protocols === undefined
          ? new Original(url)
          : new Original(url, protocols)
      const urlStr = String(url)
      if (urlStr.includes("/api/ws")) {
        sockets.push(ws)
        ws.addEventListener("close", () => {
          const i = sockets.indexOf(ws)
          if (i >= 0) sockets.splice(i, 1)
        })
      }
      return ws
    }
    TrackedWebSocket.prototype = Original.prototype
    Object.assign(TrackedWebSocket, Original)
    ;(window as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      TrackedWebSocket as unknown as typeof WebSocket
  })
}

/**
 * Send a room envelope on the browser page's OPEN `/api/ws` socket.
 * Returns false if no tracked open socket is available.
 */
export async function sendViaPageRoomWs(
  page: Page,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  return page.evaluate(
    ({ type, payload }) => {
      const sockets = (
        window as Window & { __syncAuditRoomSockets?: WebSocket[] }
      ).__syncAuditRoomSockets
      if (!sockets?.length) return false
      const open = sockets.filter((s) => s.readyState === WebSocket.OPEN)
      if (!open.length) return false
      // Most recently opened OPEN socket is the active room session.
      const ws = open[open.length - 1]!
      ws.send(
        JSON.stringify({
          type,
          requestId: crypto.randomUUID(),
          payload,
        }),
      )
      return true
    },
    { type, payload },
  )
}

export async function waitForPaused(
  observer: RoomClient,
  paused: boolean,
  timeoutMs = 12_000,
): Promise<boolean> {
  try {
    await observer.waitFor(
      (c) => c.roomState?.playback?.paused === paused,
      timeoutMs,
    )
    return true
  } catch {
    return observer.roomState?.playback?.paused === paused
  }
}

export async function waitForTimelineAnchorNear(
  observer: RoomClient,
  targetSec: number,
  toleranceSec = 2.5,
  timeoutMs = 20_000,
): Promise<boolean> {
  const targetMs = Math.round(targetSec * 1000)
  const tolMs = Math.round(toleranceSec * 1000)
  try {
    await observer.waitFor((c) => {
      const anchor = (
        c.roomState?.playback as { timelineAnchorMs?: number } | undefined
      )?.timelineAnchorMs
      if (typeof anchor !== "number") return false
      return Math.abs(anchor - targetMs) <= tolMs
    }, timeoutMs)
    return true
  } catch {
    const anchor = (
      observer.roomState?.playback as { timelineAnchorMs?: number } | undefined
    )?.timelineAnchorMs
    if (typeof anchor !== "number") return false
    return Math.abs(anchor - targetMs) <= tolMs
  }
}

export type HostPlaybackVia = "page-ws" | "room-ws" | "ui" | "none"

/**
 * Authoritative play via the browser host's own WebSocket (preferred), then
 * optional RoomClient if it holds canControlPlayback, then UI click.
 * Waits on *observer* room state — not a second-session hostCtl mirror.
 */
export async function hostPlaybackPlay(
  hostPage: Page,
  observer: RoomClient,
  clickPlayPause: (page: Page, want: "Play" | "Pause") => Promise<boolean>,
  hostCtl?: RoomClient,
): Promise<HostPlaybackVia> {
  // Rooms often start paused:false. Force a pause→play transition so we do not
  // treat a no-op wait on already-unpaused state as proof of control.
  if (observer.roomState?.playback?.paused !== true) {
    const prep = await hostPlaybackPause(
      hostPage,
      observer,
      clickPlayPause,
      hostCtl,
    )
    if (prep === "none") return "none"
  }

  return dispatchPlayPause(
    hostPage,
    observer,
    "playback:play",
    false,
    "Play",
    clickPlayPause,
    hostCtl,
  )
}

/** Read host playhead for play/pause payloads (matches UI `currentTimeMs`). */
async function readHostCurrentTimeMs(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const player = document.querySelector("media-player") as
      | (HTMLElement & {
          currentTime?: number
          state?: { currentTime?: number }
        })
      | null
    const playerTime = Number(player?.currentTime ?? player?.state?.currentTime)
    if (Number.isFinite(playerTime)) {
      return Math.max(0, Math.round(playerTime * 1000))
    }
    const media = document.querySelector(
      "video, audio",
    ) as HTMLMediaElement | null
    if (media && Number.isFinite(media.currentTime)) {
      return Math.max(0, Math.round(media.currentTime * 1000))
    }
    return null
  })
}

async function dispatchPlayPause(
  hostPage: Page,
  observer: RoomClient,
  type: "playback:play" | "playback:pause",
  wantPaused: boolean,
  clickWant: "Play" | "Pause",
  clickPlayPause: (page: Page, want: "Play" | "Pause") => Promise<boolean>,
  hostCtl?: RoomClient,
): Promise<HostPlaybackVia> {
  // Payload must be an object — omit `payload` and the server drops the
  // envelope at schema parse (no mutation). Empty `{}` is valid for play/pause;
  // prefer currentTimeMs when readable so pause reanchors like the UI path.
  const currentTimeMs = await readHostCurrentTimeMs(hostPage)
  const payload =
    currentTimeMs !== null ? { currentTimeMs } : ({} as Record<string, unknown>)

  if (await sendViaPageRoomWs(hostPage, type, payload)) {
    if (await waitForPaused(observer, wantPaused, 12_000)) return "page-ws"
  }

  if (hostCtl?.capabilities?.canControlPlayback) {
    hostCtl.send(type, payload)
    if (await waitForPaused(observer, wantPaused, 12_000)) return "room-ws"
  }

  await clickPlayPause(hostPage, clickWant)
  if (await waitForPaused(observer, wantPaused, 12_000)) return "ui"
  return "none"
}

export async function hostPlaybackPause(
  hostPage: Page,
  observer: RoomClient,
  clickPlayPause: (page: Page, want: "Play" | "Pause") => Promise<boolean>,
  hostCtl?: RoomClient,
): Promise<HostPlaybackVia> {
  return dispatchPlayPause(
    hostPage,
    observer,
    "playback:pause",
    true,
    "Pause",
    clickPlayPause,
    hostCtl,
  )
}

export async function hostPlaybackSeek(
  hostPage: Page,
  observer: RoomClient,
  targetSec: number,
  seekViaRoomControl: (page: Page, targetSec: number) => Promise<boolean>,
  hostCtl?: RoomClient,
): Promise<HostPlaybackVia> {
  const targetMs = Math.max(0, Math.round(targetSec * 1000))
  const seekPayload = { targetMs }

  if (await sendViaPageRoomWs(hostPage, "playback:seek", seekPayload)) {
    if (await waitForTimelineAnchorNear(observer, targetSec, 2.5, 18_000)) {
      return "page-ws"
    }
  }

  if (hostCtl?.capabilities?.canControlPlayback) {
    hostCtl.send("playback:seek", seekPayload)
    if (await waitForTimelineAnchorNear(observer, targetSec, 2.5, 18_000)) {
      return "room-ws"
    }
  }

  const uiOk = await seekViaRoomControl(hostPage, targetSec)
  if (uiOk) {
    const uiAnchor = await waitForTimelineAnchorNear(
      observer,
      targetSec,
      2.5,
      12_000,
    )
    return uiAnchor ? "ui" : "none"
  }
  return "none"
}
