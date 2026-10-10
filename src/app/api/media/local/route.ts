import { handleLocalMediaUploadDisabled } from "@/server/media/http/local-upload"

/**
 * Local media is no longer uploaded to the server. The providing browser keeps
 * the File and serves byte ranges on demand via WebSocket, proxied by
 * GET /api/media/local/{id}.
 */
export async function POST() {
  return handleLocalMediaUploadDisabled()
}
