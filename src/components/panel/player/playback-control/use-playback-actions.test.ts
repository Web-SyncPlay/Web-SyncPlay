import { expect, test } from "bun:test"
import type { RoomState } from "@/zod/types"
import { createPlaybackActions } from "./use-playback-actions"

function createRoomState(): RoomState {
  return {
    roomId: "room-1",
    ownerId: "owner",
    roomSecurity: {
      joinPasswordEnabled: false,
      joinPasswordUpdatedAt: null,
      admissionVersion: 1,
    },
    playback: {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 30_000,
      serverNowMs: Date.now(),
      videoLoop: "off",
      playlistLoop: "off",
      shuffle: false,
    },
    playlist: [
      {
        id: "a",
        name: "A",
        sourceKind: "remote_url",
        playbackMode: "direct",
        sourceUrl: "https://example.com/a.mp4",
        playableUrl: "https://example.com/a.mp4",
        createdBy: "owner",
        createdAt: Date.now(),
      },
      {
        id: "b",
        name: "B",
        sourceKind: "remote_url",
        playbackMode: "direct",
        sourceUrl: "https://example.com/b.mp4",
        playableUrl: "https://example.com/b.mp4",
        createdBy: "owner",
        createdAt: Date.now(),
      },
    ],
    currentIndex: 0,
    participants: {},
    history: [],
    actionLog: [],
    updatedAt: Date.now(),
    generation: 0,
    structuralRevision: 0,
  }
}

test("commitSeek ends preview and commits target", () => {
  const sent: Array<{ type: string; payload: unknown }> = []
  const actions = createPlaybackActions({
    roomState: createRoomState(),
    controlsDisabled: false,
    elapsedMs: 30_000,
    send: ((type: string, payload: unknown) => {
      sent.push({ type, payload })
    }) as never,
  })

  actions.commitSeek(45_000)

  expect(sent).toEqual([
    {
      type: "seek:preview",
      payload: { targetMs: 45_000, active: false },
    },
    {
      type: "playback:seek",
      payload: { targetMs: 45_000 },
    },
  ])
})

test("stepBy seeks from provided elapsed snapshot", () => {
  const sent: Array<{ type: string; payload: unknown }> = []
  const actions = createPlaybackActions({
    roomState: createRoomState(),
    controlsDisabled: false,
    elapsedMs: 10_000,
    send: ((type: string, payload: unknown) => {
      sent.push({ type, payload })
    }) as never,
  })

  actions.stepBy(10_000)

  expect(sent).toEqual([
    {
      type: "playback:seek",
      payload: { targetMs: 20_000 },
    },
  ])
})
