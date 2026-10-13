import { EmbedClient } from "@/components/layout/page/EmbedClient"
import { readMediaQueryParam } from "@/shared/initial-media-url"
import { decodeRoomId } from "@/shared/room-utils"

export default async function RoomEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ media?: string | string[] }>
}) {
  const { roomId: rawRoomId } = await params
  const roomId = decodeRoomId(rawRoomId)
  const query = await searchParams
  // Pass the raw query through — create-time validation happens on join.
  const initialMediaUrl = readMediaQueryParam(query.media)
  return <EmbedClient roomId={roomId} initialMediaUrl={initialMediaUrl} />
}
