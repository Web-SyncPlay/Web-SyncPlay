import { createRealtimeServer } from "@/server"
import type { NextApiRequest, NextApiResponse } from "next"
import type { Server as HttpServer } from "node:http"

type SocketServerWithRealtime = HttpServer & {
  __webSyncPlayRealtimeReady?: Promise<void>
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<void> {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate",
  )
  res.setHeader("Pragma", "no-cache")
  res.setHeader("Expires", "0")

  const socket = res.socket
  if (!socket) {
    res.status(500).json({ ok: false, error: "Socket unavailable" })
    return
  }

  const server = (socket as unknown as { server?: HttpServer }).server as
    SocketServerWithRealtime | undefined
  if (!server) {
    res.status(500).json({ ok: false, error: "Server unavailable" })
    return
  }

  if (!server.__webSyncPlayRealtimeReady) {
    server.__webSyncPlayRealtimeReady = createRealtimeServer(server)
  }
  await server.__webSyncPlayRealtimeReady
  res.status(200).json({ ok: true })
}
