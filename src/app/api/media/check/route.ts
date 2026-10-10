import { handleMediaCheck } from "@/server/media/http/check"

export async function POST(request: Request) {
  return handleMediaCheck(request)
}
