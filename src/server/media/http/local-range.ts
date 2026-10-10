/**
 * HTTP façade for GET/HEAD /api/media/local/[id].
 */

import {
  resolveServeableLocalMedia,
  viewerAuthFromLocalMediaRequest,
} from "@/server/media/local-media-access"
import {
  createLocalMediaRangeHttpResponse,
  parseLocalMediaRangeHeader,
} from "@/server/media/local-media-http"
import { ensureRelaySubscriber } from "@/server/media/local-media-relay"
import { touchLocalMediaEntry } from "@/server/media/local-media-store"

export async function handleLocalMediaRange(
  request: Request,
  id: string,
  method: "GET" | "HEAD",
): Promise<Response> {
  void ensureRelaySubscriber()

  const access = await resolveServeableLocalMedia(id, {
    viewer: viewerAuthFromLocalMediaRequest(request),
  })
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
