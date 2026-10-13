import { ControlClient } from "@/components/layout/page/ControlClient"
import { decodeRoomId } from "@/shared/room-utils"

export default async function RoomControlPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId: rawRoomId } = await params
  return <ControlClient roomId={decodeRoomId(rawRoomId)} />
}
