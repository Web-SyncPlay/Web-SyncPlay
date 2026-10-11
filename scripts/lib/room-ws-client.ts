/**
 * Minimal WebSocket room client for protocol-level e2e scripts.
 */
import { randomUUID } from "node:crypto"
import WebSocket from "ws"

export type SessionKind = "room" | "player" | "control" | "embed"

export type RoomClientOptions = {
  baseUrl: string
  roomId: string
  userId: string
  userSecret: string
  username: string
  sessionKind?: SessionKind
  controlToken?: string
  joinPassword?: string
  initialMediaUrl?: string
  /** Called for every inbound envelope (after internal state updates). */
  onMessage?: (msg: { type: string; payload: Record<string, unknown> }) => void
}

export type RoomState = {
  playback: { paused?: boolean; [key: string]: unknown }
  currentIndex?: number
  roomSecurity?: {
    joinPasswordEnabled?: boolean
    defaultJoinRole?: string
    [key: string]: unknown
  }
  playlist: Array<{
    id: string
    sourceUrl?: string
    sourceKind?: string
    localMediaId?: string
    ingestStatus?: string
    [key: string]: unknown
  }>
  participants: Record<
    string,
    {
      role?: string
      [key: string]: unknown
    }
  >
  [key: string]: unknown
}

export type Capabilities = {
  canControlPlayback?: boolean
  sessionKind?: string
  viewerToken?: string
  [key: string]: unknown
}

export class RoomClient {
  baseUrl: string
  roomId: string
  userId: string
  userSecret: string
  username: string
  sessionKind: SessionKind
  controlToken: string | undefined
  joinPassword: string | undefined
  initialMediaUrl: string | undefined
  onMessage: RoomClientOptions["onMessage"]
  ws: WebSocket | null
  roomState: RoomState | null
  capabilities: Capabilities | null
  rejected: { reason?: string; [key: string]: unknown } | null
  _waiters: Array<() => void>

  constructor(options: RoomClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "")
    this.roomId = options.roomId
    this.userId = options.userId
    this.userSecret = options.userSecret
    this.username = options.username
    this.sessionKind = options.sessionKind ?? "room"
    this.controlToken = options.controlToken
    this.joinPassword = options.joinPassword
    this.initialMediaUrl = options.initialMediaUrl
    this.onMessage = options.onMessage
    this.ws = null
    this.roomState = null
    this.capabilities = null
    this.rejected = null
    this._waiters = []
  }

  get wsUrl() {
    return this.baseUrl.replace(/^http/, "ws") + "/api/ws"
  }

  connect() {
    return new Promise<void>(async (resolve, reject) => {
      try {
        await fetch(`${this.baseUrl}/api/ws?init=${Date.now()}`, {
          cache: "no-store",
        })
      } catch {
        // ignore — upgrade probe is best-effort
      }
      const ws = new WebSocket(this.wsUrl)
      this.ws = ws
      const timer = setTimeout(
        () => reject(new Error("ws connect timeout")),
        15_000,
      )
      ws.on("open", () => {
        clearTimeout(timer)
        this.send("room:join", {
          roomId: this.roomId,
          userId: this.userId,
          userSecret: this.userSecret,
          username: this.username,
          sessionKind: this.sessionKind,
          controlToken: this.controlToken,
          joinPassword: this.joinPassword,
          initialMediaUrl: this.initialMediaUrl,
        })
        resolve()
      })
      ws.on("error", (err) => {
        clearTimeout(timer)
        reject(err)
      })
      ws.on("message", (raw, isBinary) => {
        if (isBinary) return
        const msg = JSON.parse(String(raw)) as {
          type: string
          payload: Record<string, unknown>
        }
        if (msg.type === "room:snapshot" || msg.type === "room:state") {
          this.roomState = msg.payload as RoomState
          this._flush()
        } else if (msg.type === "session:capabilities") {
          this.capabilities = msg.payload as Capabilities
          this._flush()
        } else if (msg.type === "room:join:rejected") {
          this.rejected = msg.payload as { reason?: string }
          this._flush()
        } else if (msg.type === "room:control" && this.roomState) {
          const payload = msg.payload as {
            playback: RoomState["playback"]
            currentIndex?: number
          }
          this.roomState = {
            ...this.roomState,
            playback: payload.playback,
            currentIndex: payload.currentIndex,
          }
          this._flush()
        }
        this.onMessage?.(msg)
      })
    })
  }

  _flush() {
    const waiters = this._waiters.splice(0)
    for (const w of waiters) w()
  }

  waitFor(
    predicate: (client: RoomClient) => unknown,
    timeoutMs = 20_000,
  ): Promise<RoomClient> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const check = () => {
        if (predicate(this)) return resolve(this)
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`waitFor timeout after ${timeoutMs}ms`))
        }
        this._waiters.push(() => {
          try {
            check()
          } catch (e) {
            reject(e)
          }
        })
        setTimeout(() => {
          try {
            check()
          } catch (e) {
            reject(e)
          }
        }, 250)
      }
      check()
    })
  }

  send(type: string, payload: Record<string, unknown>) {
    this.ws!.send(
      JSON.stringify({
        type,
        requestId: randomUUID(),
        payload,
      }),
    )
  }

  /** Send a pre-encoded binary frame (e.g. LMC local-media chunk). */
  sendBinary(data: Uint8Array) {
    this.ws!.send(data)
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
  }
}
