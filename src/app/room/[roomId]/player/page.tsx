import { PlayerEmbedClient } from "@/components/layout/page/PlayerEmbedClient"
import { decodeRoomId } from "@/shared/room-utils"

export default async function RoomPlayerPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId: rawRoomId } = await params
  return <PlayerEmbedClient roomId={decodeRoomId(rawRoomId)} />
}
