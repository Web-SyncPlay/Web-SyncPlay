import { RoomClient } from "@/components/layout/page/RoomClient"
import { readMediaQueryParam } from "@/shared/initial-media-url"

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ media?: string | string[] }>
}) {
  const { roomId } = await params
  const query = await searchParams
  const initialMediaUrl = readMediaQueryParam(query.media)
  return <RoomClient roomId={roomId} initialMediaUrl={initialMediaUrl} />
}
