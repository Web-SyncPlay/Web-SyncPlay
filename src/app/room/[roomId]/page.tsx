import { RoomClient } from "@/components/layout/page/RoomClient"

function parseInitialMediaUrl(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.href
  } catch {
    return undefined
  }
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ media?: string | string[] }>
}) {
  const { roomId } = await params
  const query = await searchParams
  const initialMediaUrl = parseInitialMediaUrl(query.media)
  return <RoomClient roomId={roomId} initialMediaUrl={initialMediaUrl} />
}
