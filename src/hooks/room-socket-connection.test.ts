import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test"
import { createControlTokenReminter } from "@/lib/control-token-client"
import type { JoinStatus, SessionCapabilities } from "@/lib/room-join-client"
import type { RoomState } from "@/zod/types"
import { createRoomSocketConnection } from "./room-socket-connection"

mock.module("@/hooks/room-socket-local-media", () => ({
  createRoomSocketLocalMediaSession: () => ({
    provideViaSfu: () => undefined,
    handleEnvelope: () => false,
    bootstrapAfterFirstSnapshot: () => undefined,
    onSocketClose: () => undefined,
  }),
}))

class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  static latest: FakeWebSocket | null = null

  readyState = FakeWebSocket.CONNECTING
  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.latest = this
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function createConnectionHarness(input?: {
  sessionKind?: "room" | "control"
  controlToken?: string
}) {
  const sessionKind = input?.sessionKind ?? "room"
  const statuses: JoinStatus[] = []
  const joinErrors: (string | null)[] = []
  let roomState: RoomState | null = null
  let sessionCapabilities: SessionCapabilities = {
    canControlPlayback: false,
    canManagePlaylist: false,
    canManageRoomSecurity: false,
    isControlSession: sessionKind === "control",
    controlAuthorized: false,
    sessionKind,
  }

  const wsRef = { current: null as WebSocket | null }
  const stateTimeoutRef = { current: undefined as number | undefined }
  const hasReceivedStateRef = { current: false }
  const roomStateRef = { current: null as RoomState | null }
  const joinPasswordRef = { current: "" }
  const sendJoinRef = { current: null as (() => void) | null }
  const sfuProvideRef = { current: null as ((id: string) => void) | null }
  const controlTokenRef = { current: input?.controlToken }
  const usernameRef = { current: "guest" }
  const controlTokenReminter = createControlTokenReminter()

  const connection = createRoomSocketConnection({
    roomId: "room-1",
    sessionKind,
    identity: { userId: "user-1", userSecret: "secret-1" },
    getInitialMediaUrl: () => undefined,
    getJoinPassword: () => joinPasswordRef.current,
    controlTokenRef,
    usernameRef,
    roomStateRef,
    wsRef,
    stateTimeoutRef,
    hasReceivedStateRef,
    sfuProvideRef,
    sendJoinRef,
    controlTokenReminter,
    setRoomState: (value) => {
      roomState = typeof value === "function" ? value(roomState) : value
      roomStateRef.current = roomState
    },
    setStatus: (value) => {
      statuses.push(typeof value === "function" ? value(statuses.at(-1) ?? "connecting") : value)
    },
    setJoinError: (value) => {
      joinErrors.push(typeof value === "function" ? value(joinErrors.at(-1) ?? null) : value)
    },
    setSessionCapabilities: (value) => {
      sessionCapabilities =
        typeof value === "function" ? value(sessionCapabilities) : value
    },
    fetchWsInit: async () => true,
    createWebSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket,
    wsOrigin: "ws://test.local/api/ws",
  })

  return {
    connection,
    get ws() {
      return FakeWebSocket.latest
    },
    statuses,
    joinErrors,
    get roomState() {
      return roomState
    },
    get sessionCapabilities() {
      return sessionCapabilities
    },
    controlTokenRef,
    controlTokenReminter,
  }
}

describe("createRoomSocketConnection", () => {
  beforeEach(() => {
    FakeWebSocket.latest = null
    ;(globalThis as { WebSocket?: typeof WebSocket }).WebSocket =
      FakeWebSocket as unknown as typeof WebSocket
    ;(globalThis as { window?: unknown }).window = globalThis
  })

  afterEach(() => {
    mock.restore()
    delete (globalThis as { fetch?: typeof fetch }).fetch
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
    delete (globalThis as { window?: unknown }).window
  })

  test("sends room:join when the socket opens", async () => {
    const harness = createConnectionHarness()
    await harness.connection.connect()
    harness.ws?.simulateOpen()

    expect(harness.statuses).toContain("connected")
    expect(harness.ws?.sent).toHaveLength(1)
    const join = JSON.parse(harness.ws!.sent[0]!) as { type: string }
    expect(join.type).toBe("room:join")
    harness.connection.dispose()
  })

  test("maps room:join:rejected to password UI state", async () => {
    const harness = createConnectionHarness()
    await harness.connection.connect()
    harness.ws?.simulateOpen()
    harness.ws?.simulateMessage({
      type: "room:join:rejected",
      payload: { reason: "password_required" },
    })

    expect(harness.joinErrors.at(-1)).toBe(
      "This room requires a join password.",
    )
    expect(harness.statuses.at(-1)).toBe("awaiting_password")
    harness.connection.dispose()
  })

  test("stops reconnect churn after media_url_unsupported", async () => {
    let initCalls = 0
    const connection = createRoomSocketConnection({
      roomId: "room-1",
      sessionKind: "room",
      identity: { userId: "user-1", userSecret: "secret-1" },
      getInitialMediaUrl: () => "https://example.test/video.mp4",
      getJoinPassword: () => "",
      controlTokenRef: { current: undefined },
      usernameRef: { current: "guest" },
      roomStateRef: { current: null },
      wsRef: { current: null },
      stateTimeoutRef: { current: undefined },
      hasReceivedStateRef: { current: false },
      sfuProvideRef: { current: null },
      sendJoinRef: { current: null },
      controlTokenReminter: createControlTokenReminter(),
      setRoomState: () => undefined,
      setStatus: () => undefined,
      setJoinError: () => undefined,
      setSessionCapabilities: () => undefined,
      fetchWsInit: async () => {
        initCalls += 1
        return true
      },
      createWebSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket,
      wsOrigin: "ws://test.local/api/ws",
    })

    await connection.connect()
    FakeWebSocket.latest?.simulateOpen()
    FakeWebSocket.latest?.simulateMessage({
      type: "room:join:rejected",
      payload: { reason: "media_url_unsupported" },
    })
    FakeWebSocket.latest?.close()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(initCalls).toBe(1)
    connection.dispose()
  })

  test("remints control token once and reconnects", async () => {
    const fetchMock = mock(() =>
      Promise.resolve(Response.json({ token: "fresh-token" })),
    )
    ;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
    ;(globalThis as { window?: Window & typeof globalThis }).window = Object.assign(
      globalThis as Window & typeof globalThis,
      {
        sessionStorage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
        localStorage: {
          getItem: () => null,
          setItem: () => undefined,
          removeItem: () => undefined,
        },
      },
    )

    const harness = createConnectionHarness({ sessionKind: "control" })
    await harness.connection.connect()
    harness.ws?.simulateOpen()

    const firstWs = harness.ws!
    firstWs.simulateMessage({
      type: "room:snapshot",
      payload: {
        generation: 1,
        structuralRevision: 1,
        participants: {
          "user-1": { userId: "user-1", role: "owner", username: "Host" },
        },
        playback: {
          playing: false,
          currentTime: 0,
          playbackRate: 1,
        },
        playlist: [],
        currentIndex: 0,
      },
    })

    firstWs.simulateMessage({
      type: "session:capabilities",
      payload: {
        controlAuthorized: false,
        sessionKind: "control",
        isControlSession: true,
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(harness.controlTokenRef.current).toBe("fresh-token")
    expect(firstWs.readyState).toBe(FakeWebSocket.CLOSED)

    firstWs.simulateMessage({
      type: "session:capabilities",
      payload: { controlAuthorized: false, sessionKind: "control" },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    harness.connection.dispose()
  })
})
