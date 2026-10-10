import { handleLocalMediaRange } from "@/server/media/http/local-range"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return handleLocalMediaRange(request, id, "GET")
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  return handleLocalMediaRange(request, id, "HEAD")
}
