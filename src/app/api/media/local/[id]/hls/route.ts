import { resolveServeableLocalMedia } from "@/server/media/local-media-access"
import { buildLocalMediaMasterPlaylist } from "@/server/media/local-media-hls"
import { touchLocalMediaEntry } from "@/server/media/local-media-store"

/**
 * GET /api/media/local/{id}/hls
 * Multi-variant master when ABR is ready; otherwise single-variant wrapper.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const access = await resolveServeableLocalMedia(id, { rejectAbrChild: true })
  if (!access.ok) {
    return access.response
  }

  void touchLocalMediaEntry(id)

  const body = buildLocalMediaMasterPlaylist({
    parentId: id,
    variants:
      access.entry.abr?.status === "ready" ? access.entry.abr.variants : null,
  })

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/vnd.apple.mpegurl",
      "cache-control": "private, max-age=5",
    },
  })
}
