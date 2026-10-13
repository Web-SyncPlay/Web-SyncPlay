import { RoomClient } from "@/components/layout/page/RoomClient"
import { readMediaQueryParam } from "@/shared/initial-media-url"
import { decodeRoomId } from "@/shared/room-utils"

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ media?: string | string[] }>
}) {
  const { roomId: rawRoomId } = await params
  const roomId = decodeRoomId(rawRoomId)
  const query = await searchParams
  const initialMediaUrl = readMediaQueryParam(query.media)
  return <RoomClient roomId={roomId} initialMediaUrl={initialMediaUrl} />
}
