import { env } from "@/env"
import { getCommandClient } from "@/server/redis/client"
import { NextResponse } from "next/server"

export async function GET() {
  let valkeyOk = false
  try {
    const client = await getCommandClient()
    valkeyOk = (await client.ping()) === "PONG"
  } catch {
    valkeyOk = false
  }

  const ok = valkeyOk
  return NextResponse.json(
    {
      ok,
      valkey: valkeyOk,
      ytdlpBin: env.YTDLP_BIN,
      nodeEnv: env.NODE_ENV,
    },
    { status: ok ? 200 : 503 },
  )
}
