import type { Page } from "playwright"
import type { RoomClient } from "./room-ws-client.ts"
import {
  createServerClockEstimate,
  type PlaybackClockFields,
  type ServerClockEstimate,
} from "./server-clock-estimate.ts"

export { createServerClockEstimate, expectedPlayheadSec }
export type { ServerClockEstimate, PlaybackClockFields }

function playbackFromPayload(payload: Record<string, unknown>): PlaybackClockFields {
  const playback = payload.playback as PlaybackClockFields | undefined
  const serverNowMs =
    typeof payload.serverNowMs === "number"
      ? payload.serverNowMs
      : playback?.serverNowMs
  return { ...playback, serverNowMs }
}

/** Feed serverNowMs from inbound room envelopes into a clock estimate. */
export function wireServerClockFromRoomClient(
  client: RoomClient,
  clock: ServerClockEstimate,
): void {
  const prev = client.onMessage
  client.onMessage = (msg) => {
    if (
      msg.type === "room:snapshot" ||
      msg.type === "room:state" ||
      msg.type === "room:control"
    ) {
      const pb = playbackFromPayload(msg.payload)
      if (typeof pb.serverNowMs === "number") {
        clock.observeServerNowMs(pb.serverNowMs)
      }
    }
    prev?.(msg)
  }
  if (client.roomState?.playback) {
    const pb = client.roomState.playback as PlaybackClockFields
    if (typeof pb.serverNowMs === "number") {
      clock.observeServerNowMs(pb.serverNowMs)
    }
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

export async function hostPlaybackPlay(
  hostCtl: RoomClient,
  hostPage: Page,
  clickPlayPause: (page: Page, want: "Play" | "Pause") => Promise<boolean>,
): Promise<"ws" | "ui"> {
  hostCtl.send("playback:play")
  const wsOk = await hostCtl
    .waitFor((c) => c.roomState?.playback?.paused === false, 12_000)
    .then(() => true)
    .catch(() => false)
  if (wsOk) return "ws"
  await clickPlayPause(hostPage, "Play")
  return "ui"
}

export async function hostPlaybackPause(
  hostCtl: RoomClient,
  hostPage: Page,
  clickPlayPause: (page: Page, want: "Play" | "Pause") => Promise<boolean>,
): Promise<"ws" | "ui"> {
  hostCtl.send("playback:pause")
  const wsOk = await hostCtl
    .waitFor((c) => c.roomState?.playback?.paused === true, 12_000)
    .then(() => true)
    .catch(() => false)
  if (wsOk) return "ws"
  await clickPlayPause(hostPage, "Pause")
  return "ui"
}

export async function hostPlaybackSeek(
  hostCtl: RoomClient,
  hostPage: Page,
  observer: RoomClient,
  targetSec: number,
  seekViaRoomControl: (page: Page, targetSec: number) => Promise<boolean>,
): Promise<"ws" | "ui" | "none"> {
  hostCtl.send("playback:seek", { targetMs: Math.max(0, Math.round(targetSec * 1000)) })
  const wsOk = await waitForTimelineAnchorNear(observer, targetSec, 2.5, 18_000)
  if (wsOk) return "ws"
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
