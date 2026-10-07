import { cleanupInactiveRooms } from "@/server"
import { withOpsAuth } from "@/server/ops-auth"
import { NextResponse } from "next/server"

async function runCleanup() {
  const result = await cleanupInactiveRooms()
  return NextResponse.json({ ok: true, ...result })
}

export async function POST(request: Request) {
  return withOpsAuth(request, runCleanup)
}

export async function GET(request: Request) {
  return withOpsAuth(request, runCleanup)
}
