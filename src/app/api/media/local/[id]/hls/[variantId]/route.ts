import { handleLocalMediaVariantHls } from "@/server/media/http/local-hls"

/**
 * GET /api/media/local/{id}/hls/{variantId}
 * Single-segment VOD media playlist for one ladder rung.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; variantId: string }> },
) {
  const { id, variantId } = await context.params
  return handleLocalMediaVariantHls(request, id, variantId)
}
