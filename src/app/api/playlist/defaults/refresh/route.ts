import { assertOpsAuthorized } from "@/server/ops-auth"
import { getCommandClient } from "@/server"
import { keys } from "@/server/redis/keys"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const denied = assertOpsAuthorized(request)
  if (denied) return denied
  const client = await getCommandClient()
  await client.set(keys.dailyDefaults(), JSON.stringify([]))
  return NextResponse.json({ ok: true, count: 0 })
}

export async function GET(request: Request) {
  const denied = assertOpsAuthorized(request)
  if (denied) return denied
  const client = await getCommandClient()
  const raw = (await client.get(keys.dailyDefaults())) ?? "[]"

  return NextResponse.json({
    items: JSON.parse(raw) as Array<{ title: string; url: string }>,
  })
}
