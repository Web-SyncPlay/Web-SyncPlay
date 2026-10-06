import { env } from "@/env"
import {
  installShutdownOnce,
  registerShutdownHandler,
} from "@/server/lifecycle"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import { WebSocketServer, type WebSocket } from "ws"

type UpgradeListener = (
  req: IncomingMessage,
  socket: import("node:net").Socket,
  head: Buffer,
) => void

type WsTransportSlot = {
  wss?: WebSocketServer
  heartbeat?: ReturnType<typeof setInterval>
  onConnection?: (ws: WebSocket) => void
  lastPongAt: WeakMap<WebSocket, number>
  routingInstalled?: boolean
}

function getTransportSlot() {
  const g = globalThis as typeof globalThis & {
    __webSyncPlayWsTransport?: WsTransportSlot
  }
  if (!g.__webSyncPlayWsTransport) {
    g.__webSyncPlayWsTransport = {
      lastPongAt: new WeakMap(),
    }
  }
  return g.__webSyncPlayWsTransport
}

let shutdownRegistered = false

function registerWsShutdown(slot: WsTransportSlot) {
  if (shutdownRegistered) {
    return
  }
  shutdownRegistered = true
  installShutdownOnce()
  registerShutdownHandler(async () => {
    if (slot.heartbeat) {
      clearInterval(slot.heartbeat)
      slot.heartbeat = undefined
    }
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
      slot.wss = undefined
    }
    slot.routingInstalled = false
  })
}

/**
 * Idempotent: first call installs upgrade routing + WSS + heartbeat; later calls only refresh onConnection.
 */
export function attachWebSocketTransport(
  server: HttpServer,
  onConnection: (ws: WebSocket) => void,
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
    __webSyncPlayWsServer?: WebSocketServer
  }

  if (!enhancedServer.__webSyncPlayWsRoutingInstalled) {
    const existingUpgradeListeners = server.listeners(
      "upgrade",
    ) as UpgradeListener[]
    server.removeAllListeners("upgrade")
    enhancedServer.__webSyncPlayWsRoutingInstalled = true

    server.on("upgrade", (req: IncomingMessage, socket, head) => {
      if (req.url?.startsWith("/api/ws")) {
        console.log(`[realtime] upgrade request: ${req.url}`)
        wss.handleUpgrade(req, socket, head, (ws) =>
          wss.emit("connection", ws, req),
        )
        return
      }

      for (const listener of existingUpgradeListeners) {
        listener.call(server, req, socket as import("node:net").Socket, head)
      }
    })
  }

  enhancedServer.__webSyncPlayWsServer = wss

  const heartbeatTimeoutMs = env.WS_HEARTBEAT_INTERVAL_MS * 3
  slot.heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue
      const lastSeen = slot.lastPongAt.get(ws) ?? Date.now()
      if (Date.now() - lastSeen > heartbeatTimeoutMs) {
        ws.terminate()
        continue
      }
      ws.ping()
    }
  }, env.WS_HEARTBEAT_INTERVAL_MS)

  wss.on("close", () => {
    if (slot.heartbeat) {
      clearInterval(slot.heartbeat)
      slot.heartbeat = undefined
    }
  })

  wss.on("connection", (ws) => {
    slot.lastPongAt.set(ws, Date.now())
    ws.on("pong", () => {
      slot.lastPongAt.set(ws, Date.now())
    })
    slot.onConnection?.(ws)
  })
}

export function getLastPongMap() {
  return getTransportSlot().lastPongAt
}
