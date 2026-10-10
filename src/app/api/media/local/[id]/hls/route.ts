import { handleLocalMediaMasterHls } from "@/server/media/http/local-hls"

/**
 * GET /api/media/local/{id}/hls
 * Multi-variant master when ABR is ready; otherwise single-variant wrapper.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return handleLocalMediaMasterHls(request, id)
}
