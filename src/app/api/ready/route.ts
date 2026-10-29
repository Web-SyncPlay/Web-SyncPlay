import { NextResponse } from "next/server"

import { isProcessDraining } from "@/server/lifecycle"
import { getCommandClient } from "@/server/redis/client"

async function pingValkey(): Promise<boolean> {
  try {
    const client = await getCommandClient()
    return (await client.ping()) === "PONG"
  } catch {
    return false
  }
}

/**
 * Readiness probe: Valkey reachable and process not draining.
 * Load balancers / orchestrators should use this (not `/api/health`) to stop
 * sending new traffic during shutdown. Does not start background maintenance.
 */
export async function GET() {
  const draining = isProcessDraining()
  if (draining) {
    return NextResponse.json(
      { ok: false, ready: false, draining: true, valkey: null },
      { status: 503 },
    )
  }

  const valkeyOk = await pingValkey()
  return NextResponse.json(
    { ok: valkeyOk, ready: valkeyOk, draining: false, valkey: valkeyOk },
    { status: valkeyOk ? 200 : 503 },
  )
}
