import { NextResponse } from "next/server"

/**
 * Local media is no longer uploaded to the server. The providing browser keeps
 * the File and serves byte ranges on demand via WebSocket, proxied by
 * GET /api/media/local/{id}.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Local media upload is disabled. Share a local file from the room UI; bytes are streamed from the provider on demand.",
      code: "local_media_relay_only",
    },
    { status: 410 },
  )
}
