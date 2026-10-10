import { handleLocalMediaInternalRange } from "@/server/media/http/local-internal"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return handleLocalMediaInternalRange(request, id, "GET")
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return handleLocalMediaInternalRange(request, id, "HEAD")
}
