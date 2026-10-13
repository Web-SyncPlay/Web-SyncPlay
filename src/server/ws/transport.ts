import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"
import { clientIpFromUpgradeRequest } from "@/server/security/rate-limit"
import {
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
} from "@/server/ws/heartbeat"
import { setSocketClientIp } from "@/server/ws/registry"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Socket } from "node:net"
import { WebSocketServer, type WebSocket } from "ws"
import {
  isWsApiUpgradeUrl,
  shouldTerminateForMissedHeartbeat,
} from "./transport-helpers"

type UpgradeListener = (
  req: IncomingMessage,
  socket: Socket,
  head: Buffer,
) => void

type WsTransportSlot = {
  wss?: WebSocketServer
  heartbeat?: ReturnType<typeof setInterval>
  onConnection?: (ws: WebSocket, req: IncomingMessage) => void
  lastPongAt: WeakMap<WebSocket, number>
  /** When the last WS ping frame was sent (for RTT on pong). */
  lastPingAt: WeakMap<WebSocket, number>
}

function getTransportSlot(): WsTransportSlot {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayWsTransport?: WsTransportSlot
  }
  g.__webSyncPlayWsTransport ??= {
    lastPongAt: new WeakMap(),
    lastPingAt: new WeakMap(),
  }
  const slot = g.__webSyncPlayWsTransport
  slot.lastPingAt ??= new WeakMap()
  return slot
}

/** Notify the client of measured RTT + fresh server wall time (clock sync). */
function sendSessionClock(ws: WebSocket, rttMs: number, serverNowMs: number) {
  if (ws.readyState !== ws.OPEN) return
  try {
    ws.send(
      JSON.stringify({
        type: "session:clock",
        payload: { serverNowMs, rttMs },
      }),
    )
  } catch {
    // Socket may be closing; next heartbeat will retry.
  }
}

let shutdownRegistered = false

function clearHeartbeat(slot: WsTransportSlot) {
  if (!slot.heartbeat) return
  clearInterval(slot.heartbeat)
  slot.heartbeat = undefined
}

function registerWsShutdown(slot: WsTransportSlot) {
  if (shutdownRegistered) {
    return
  }
  shutdownRegistered = true
  installShutdownOnce()
  registerShutdownHandler(async () => {
    clearHeartbeat(slot)
    if (slot.wss) {
      for (const ws of slot.wss.clients) {
        try {
          ws.close(1001, "server shutdown")
        } catch {
          /* ignore */
        }
      }
      await new Promise<void>((resolve, reject) => {
        slot.wss!.close((err) => (err ? reject(err) : resolve()))
      }).catch((e) => console.error("[ws] close error", e))
    }
    slot.wss = undefined
  })
}

/**
 * Idempotent: first call installs upgrade routing + WSS + heartbeat; later calls only refresh onConnection.
 */
export function attachWebSocketTransport(
  server: HttpServer,
  onConnection: (ws: WebSocket, req: IncomingMessage) => void,
) {
  const slot = getTransportSlot()
  slot.onConnection = onConnection

  if (slot.wss) {
    return
  }

  const wss = new WebSocketServer({ noServer: true })
  slot.wss = wss
  registerWsShutdown(slot)

  const enhancedServer = server as HttpServer & {
    __webSyncPlayWsRoutingInstalled?: boolean
  }

  if (!enhancedServer.__webSyncPlayWsRoutingInstalled) {
    const existingUpgradeListeners = server.listeners(
      "upgrade",
    ) as UpgradeListener[]
    server.removeAllListeners("upgrade")
    enhancedServer.__webSyncPlayWsRoutingInstalled = true

    // Resolve WSS from the slot so a post-shutdown recreate still works.
    server.on("upgrade", (req: IncomingMessage, socket, head) => {
      if (isWsApiUpgradeUrl(req.url)) {
        const current = getTransportSlot().wss
        if (!current) {
          socket.destroy()
          return
        }
        console.log(`[ws] upgrade request: ${req.url}`)
        current.handleUpgrade(req, socket, head, (upgraded) =>
          current.emit("connection", upgraded, req),
        )
        return
      }

      for (const listener of existingUpgradeListeners) {
        listener.call(server, req, socket as Socket, head)
      }
    })
  }

  slot.heartbeat = setInterval(() => {
    const nowMs = Date.now()
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue
      if (
        shouldTerminateForMissedHeartbeat({
          nowMs,
          lastPongAtMs: slot.lastPongAt.get(ws),
          heartbeatTimeoutMs: WS_HEARTBEAT_TIMEOUT_MS,
        })
      ) {
        ws.terminate()
        continue
      }
      slot.lastPingAt.set(ws, nowMs)
      ws.ping()
    }
  }, WS_HEARTBEAT_INTERVAL_MS)

  wss.on("close", () => {
    clearHeartbeat(slot)
  })

  wss.on("connection", (ws, req: IncomingMessage) => {
    slot.lastPongAt.set(ws, Date.now())
    setSocketClientIp(ws, clientIpFromUpgradeRequest(req))
    ws.on("pong", () => {
      const nowMs = Date.now()
      slot.lastPongAt.set(ws, nowMs)
      const pingAt = slot.lastPingAt.get(ws)
      if (pingAt !== undefined) {
        const rttMs = Math.max(0, nowMs - pingAt)
        sendSessionClock(ws, rttMs, nowMs)
      }
    })
    ws.on("close", () => {
      slot.lastPongAt.delete(ws)
      slot.lastPingAt.delete(ws)
    })
    slot.onConnection?.(ws, req)
  })
}
