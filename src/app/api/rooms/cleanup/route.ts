import { assertOpsAuthorized } from "@/server/ops-auth"
import { cleanupInactiveRooms } from "@/server"
import { NextResponse } from "next/server"

export async function POST(request: Request) {
  const denied = assertOpsAuthorized(request)
  if (denied) return denied
  const result = await cleanupInactiveRooms()
  return NextResponse.json({ ok: true, ...result })
}

export async function GET(request: Request) {
  const denied = assertOpsAuthorized(request)
  if (denied) return denied
  const result = await cleanupInactiveRooms()
  return NextResponse.json({ ok: true, ...result })
}
