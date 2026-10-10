/**
 * Regression: live sync clock ticks must not clear/restart the 12s buffering
 * watchdog timer (deps must be buffering identity only).
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import {
  act,
  createElement,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react"
import { createRoot, type Root } from "react-dom/client"
import { useBufferingWatchdog } from "./use-buffering-watchdog"

type RoomPlayback = {
  paused: boolean
  playbackRate: number
  timelineAnchorMs: number
  serverNowMs: number
  videoLoop: string
}

type HarnessProps = {
  isBuffering: boolean
  bufferingStartedAt: number | null
  roomPlayback: RoomPlayback
  activePlaybackSrc: string
  viewType: "audio" | "video"
  currentItem: { id: string; name: string } | null
  setIsBuffering: (next: boolean) => void
  setPlayerRemountNonce: Dispatch<SetStateAction<number>>
}

/** Same shape as synced-media-player-memo.test — React createRoot needs nodeType=1. */
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

function WatchdogHarness(props: HarnessProps) {
  const isMediaReadyRef = useRef(false)
  // Epoch is fixed for this harness mount; clock-tick re-renders must not
  // rewrite the ref during render (react-hooks/refs).
  const bufferingSinceRef = useRef<number | null>(props.bufferingStartedAt)
  const participantStatusErrorRef = useRef<string | null>(null)
  const pendingSyncRef = useRef(null)

  useBufferingWatchdog({
    currentItem: props.currentItem,
    activePlaybackSrc: props.activePlaybackSrc,
    viewType: props.viewType,
    isBuffering: props.isBuffering,
    isMediaReadyRef,
    bufferingSinceRef,
    participantStatusErrorRef,
    pendingSyncRef,
    roomPlayback: props.roomPlayback,
    setIsBuffering: props.setIsBuffering,
    setPlayerRemountNonce: props.setPlayerRemountNonce,
  })

  return null
}

describe("useBufferingWatchdog", () => {
  let root: Root | null = null

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount()
      })
      root = null
    }
  })

  test("advancing roomPlayback clock fields does not clear or restart the timer", async () => {
    const document = installMinimalDom()

    const realSetTimeout = globalThis.setTimeout.bind(globalThis)
    const realClearTimeout = globalThis.clearTimeout.bind(globalThis)

    const windowSetTimeoutSpy = spyOn(
      globalThis.window,
      "setTimeout",
    ).mockImplementation(((handler: TimerHandler, ms?: number, ...args: unknown[]) =>
      realSetTimeout(
        handler as never,
        ms as never,
        ...(args as never[]),
      )) as unknown as typeof setTimeout)
    const windowClearTimeoutSpy = spyOn(
      globalThis.window,
      "clearTimeout",
    ).mockImplementation(
      (((id?: number) =>
        realClearTimeout(id as never)) as unknown) as typeof clearTimeout,
    )

    const container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container as unknown as Element)

    const startedAt = Date.now() - 1_000
    const basePlayback: RoomPlayback = {
      paused: false,
      playbackRate: 1,
      timelineAnchorMs: 5_000,
      serverNowMs: 1_000,
      videoLoop: "off",
    }

    const setIsBuffering = () => {}
    const setPlayerRemountNonce: Dispatch<SetStateAction<number>> = () => {}

    const baseProps: HarnessProps = {
      isBuffering: true,
      bufferingStartedAt: startedAt,
      roomPlayback: basePlayback,
      activePlaybackSrc: "https://example.com/a.mp4",
      viewType: "video",
      currentItem: { id: "item-1", name: "Clip" },
      setIsBuffering,
      setPlayerRemountNonce,
    }

    await act(async () => {
      root!.render(createElement(WatchdogHarness, baseProps))
    })

    const armedSetTimeoutCalls = windowSetTimeoutSpy.mock.calls.length
    expect(armedSetTimeoutCalls).toBeGreaterThanOrEqual(1)
    const clearsAfterArm = windowClearTimeoutSpy.mock.calls.length

    // Live sync: clock / pause / rate / loop tick without a new buffering episode.
    await act(async () => {
      root!.render(
        createElement(WatchdogHarness, {
          ...baseProps,
          // New object identity each parent render (mirrors session hook).
          currentItem: { id: "item-1", name: "Clip" },
          roomPlayback: {
            paused: true,
            playbackRate: 1.25,
            timelineAnchorMs: 9_500,
            serverNowMs: 8_000,
            videoLoop: "one",
          },
        }),
      )
    })

    expect(windowClearTimeoutSpy.mock.calls.length).toBe(clearsAfterArm)
    expect(windowSetTimeoutSpy.mock.calls.length).toBe(armedSetTimeoutCalls)

    windowSetTimeoutSpy.mockRestore()
    windowClearTimeoutSpy.mockRestore()
  })
})
