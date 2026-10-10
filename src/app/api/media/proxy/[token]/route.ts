import {
  handleMediaProxyGet,
  handleMediaProxyHead,
} from "@/server/media/http/proxy"

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  return handleMediaProxyGet(request, token)
}

export async function HEAD(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  return handleMediaProxyHead(request, token)
}
