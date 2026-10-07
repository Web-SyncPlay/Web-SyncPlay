import { getCommandClient } from "@/server"
import { withOpsAuth } from "@/server/ops-auth"
import { keys } from "@/server/redis/keys"
import { roomStateTtlSeconds } from "@/zod/types"
import { NextResponse } from "next/server"
import { z } from "zod"

const dailyDefaultItemSchema = z.object({
  title: z.string(),
  url: z.string(),
})

function parseDailyDefaults(raw: string): Array<{ title: string; url: string }> {
  try {
    const parsed = z.array(dailyDefaultItemSchema).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

export async function POST(request: Request) {
  return withOpsAuth(request, async () => {
    const client = await getCommandClient()
    await client.set(keys.dailyDefaults(), JSON.stringify([]), {
      EX: roomStateTtlSeconds,
    })
    return NextResponse.json({ ok: true, count: 0 })
  })
}

export async function GET(request: Request) {
  return withOpsAuth(request, async () => {
    const client = await getCommandClient()
    const raw = (await client.get(keys.dailyDefaults())) ?? "[]"
    return NextResponse.json({ items: parseDailyDefaults(raw) })
  })
}
