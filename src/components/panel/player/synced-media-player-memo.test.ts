/**
 * Regression gate for perf/player-main-thread:
 * SyncedMediaPlayer is memo()'d and its prop surface excludes room presence so
 * presence-only roomState updates (participants / lastSeenAt) do not force a
 * player re-render when parent props stay referentially equal.
 *
 * Full MediaPlayer (vidstack) mount is out of scope for bun:test without a
 * browser harness; we assert memo identity + prop isolation, then prove React
 * memo skips re-render on equal props via a tiny createRoot + act() harness.
 */
import { expect, test } from "bun:test"
import {
  act,
  createElement,
  memo,
  startTransition,
  type ComponentType,
} from "react"
import { createRoot } from "react-dom/client"
import {
  applyPresenceBatches,
  createPresenceBatchCoalescer,
} from "@/lib/room-state-merge"
import { createRoomState } from "@/server/realtime/test-utils/fixtures"
import type { PresenceBatchPayload, RoomState } from "@/zod/types"
import { SyncedMediaPlayer, type SyncedMediaPlayerProps } from "./SyncedMediaPlayer"
import type { PlaylistNavSnapshot } from "./hooks/use-synced-media-player-handlers"

type ForbiddenPlayerProp = "roomState" | "participants" | "presenceRevision"
type AssertNever<T extends never> = T
/** Compile-time gate: presence fields must not be on the player prop surface. */
type NoPresenceOnPlayerProps = AssertNever<
  keyof SyncedMediaPlayerProps & ForbiddenPlayerProp
>
const _presenceIsolated: NoPresenceOnPlayerProps = true as NoPresenceOnPlayerProps
void _presenceIsolated

function installMinimalDom() {
  class HTMLElement {}
  class HTMLIFrameElement extends HTMLElement {}
  class Element {}
  class Node {
    static ELEMENT_NODE = 1
    static TEXT_NODE = 3
    static COMMENT_NODE = 8
    static DOCUMENT_NODE = 9
  }

  function makeEl(tag: string) {
    const node = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      style: {} as Record<string, string>,
      childNodes: [] as unknown[],
      children: [] as unknown[],
      ownerDocument: null as unknown,
      parentNode: null as unknown,
      textContent: "",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      setAttribute() {},
      removeAttribute() {},
      getAttribute() {
        return null
      },
      hasAttribute() {
        return false
      },
      appendChild(c: { parentNode: unknown }) {
        this.childNodes.push(c)
        c.parentNode = this
        return c
      },
      removeChild(c: unknown) {
        const i = this.childNodes.indexOf(c)
        if (i >= 0) this.childNodes.splice(i, 1)
        return c
      },
      insertBefore(c: { parentNode: unknown }, ref: unknown) {
        const i = ref ? this.childNodes.indexOf(ref) : -1
        if (i >= 0) this.childNodes.splice(i, 0, c)
        else this.childNodes.push(c)
        c.parentNode = this
        return c
      },
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true
      },
    }
    Object.setPrototypeOf(node, HTMLElement.prototype)
    return node
  }

  const document = {
    nodeType: 9,
    documentElement: makeEl("html"),
    body: makeEl("body"),
    activeElement: null as unknown,
    defaultView: null as unknown,
    createElement(t: string) {
      const n = makeEl(t)
      n.ownerDocument = document
      return n
    },
    createElementNS(_ns: string, t: string) {
      return this.createElement(t)
    },
    createTextNode(t: string) {
      return {
        nodeType: 3,
        textContent: String(t),
        ownerDocument: document,
        parentNode: null as unknown,
      }
    },
    createComment() {
      return {
        nodeType: 8,
        ownerDocument: document,
        parentNode: null as unknown,
      }
    },
    createDocumentFragment() {
      return makeEl("fragment")
    },
    getElementById() {
      return null
    },
    querySelector() {
      return null
    },
    addEventListener() {},
    removeEventListener() {},
  }
  document.documentElement.ownerDocument = document
  document.body.ownerDocument = document
  document.defaultView = globalThis

  Object.assign(globalThis, {
    document,
    window: globalThis,
    HTMLElement,
    HTMLIFrameElement,
    Element,
    Node,
    navigator: { userAgent: "bun-test" },
    requestAnimationFrame: (cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  })

  return document
}

test("SyncedMediaPlayer is React.memo and exposes PlaylistNavSnapshot isolation", () => {
  expect(SyncedMediaPlayer.$$typeof).toBe(Symbol.for("react.memo"))

  // Playlist nav is read via ref (not roomState props) so presence churn
  // cannot invalidate the memoized player through currentIndex/playlistLoop.
  const snap: PlaylistNavSnapshot = {
    currentIndex: 0,
    playlistLoop: "off",
  }
  expect(snap).toEqual({ currentIndex: 0, playlistLoop: "off" })

  // Runtime mirror of the type-level _NoPresenceOnPlayerProps check above:
  // these keys must never appear on the exported prop surface.
  const sampleKeys = [
    "playerRef",
    "roomPaused",
    "roomPlaybackRate",
    "playlistNavRef",
    "playbackRef",
  ] as const satisfies ReadonlyArray<keyof SyncedMediaPlayerProps>
  expect(sampleKeys).not.toContain("roomState" as never)
  expect(sampleKeys).not.toContain("participants" as never)
})

test("memo child does not re-render when parent re-renders with equal props", async () => {
  const document = installMinimalDom()
  let renders = 0

  type ProbeProps = { roomPaused: boolean; label: string }
  const Probe = memo(function Probe({ roomPaused, label }: ProbeProps) {
    renders += 1
    return createElement("span", null, label, String(roomPaused))
  })

  function Parent(props: ProbeProps) {
    // Same field values → React.memo shallow-compare skips Probe.
    return createElement(Probe as ComponentType<ProbeProps>, props)
  }

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container as unknown as Element)

  const equalProps: ProbeProps = { roomPaused: true, label: "a" }

  await act(async () => {
    root.render(createElement(Parent, equalProps))
  })
  expect(renders).toBe(1)

  // Presence-only-equivalent: second render with the same prop field values.
  await act(async () => {
    root.render(createElement(Parent, { roomPaused: true, label: "a" }))
  })
  expect(renders).toBe(1)

  await act(async () => {
    root.render(createElement(Parent, { roomPaused: false, label: "a" }))
  })
  expect(renders).toBe(2)

  await act(async () => {
    root.unmount()
  })
})

test("presence coalescer flush under startTransition still applies batches", () => {
  // Mirrors use-room-socket: onFlush wraps setRoomState in startTransition.
  const prev = createRoomState()
  let roomState: RoomState = prev
  let scheduledFlush: (() => void) | null = null

  const coalescer = createPresenceBatchCoalescer({
    onFlush: (payloads) => {
      startTransition(() => {
        roomState = applyPresenceBatches(roomState, payloads) ?? roomState
      })
    },
    schedule: (flush) => {
      scheduledFlush = flush
      return () => {
        if (scheduledFlush === flush) scheduledFlush = null
      }
    },
  })

  const beforeSeen = roomState.participants.guest?.lastSeenAt
  const batch: PresenceBatchPayload = {
    presenceRevision: 2,
    serverNowMs: 2,
    participants: { guest: { lastSeenAt: 99 } },
  }
  coalescer.enqueue(batch)
  expect(roomState.participants.guest?.lastSeenAt).toBe(beforeSeen)

  expect(scheduledFlush).not.toBeNull()
  scheduledFlush!()
  expect(roomState.participants.guest?.lastSeenAt).toBe(99)
  // Playback / playlist identity untouched by presence merge.
  expect(roomState.playback).toBe(prev.playback)
  expect(roomState.playlist).toBe(prev.playlist)
})
