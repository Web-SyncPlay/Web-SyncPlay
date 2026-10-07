import { resolveServeableLocalMedia } from "@/server/media/local-media-access"
import {
  createLocalMediaRangeHttpResponse,
  parseLocalMediaRangeHeader,
} from "@/server/media/local-media-http"
import { ensureRelaySubscriber } from "@/server/media/local-media-relay"
import { touchLocalMediaEntry } from "@/server/media/local-media-store"

async function handleLocalMediaRequest(
  request: Request,
  context: { params: Promise<{ id: string }> },
  method: "GET" | "HEAD",
) {
  void ensureRelaySubscriber()

  const { id } = await context.params
  const access = await resolveServeableLocalMedia(id)
  if (!access.ok) {
    return access.response
  }

  // Keep metadata alive while viewers are actively pulling ranges.
  void touchLocalMediaEntry(id)

  return createLocalMediaRangeHttpResponse({
    entry: access.entry,
    rangeInfo: parseLocalMediaRangeHeader(
      request.headers.get("range"),
      access.entry.sizeBytes,
    ),
    method,
    cacheControl: "private, max-age=15",
    logContext: { mediaId: id },
  })
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return await handleLocalMediaRequest(request, context, "GET")
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return await handleLocalMediaRequest(request, context, "HEAD")
}
