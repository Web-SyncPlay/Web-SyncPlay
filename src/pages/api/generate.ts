import { listRooms } from "~/lib/cache/redis";
import { generateId } from "~/lib/utils";
import { type NextApiRequest, type NextApiResponse } from "next";

export default async function generate(
  _: NextApiRequest,
  res: NextApiResponse,
) {
  const rooms = await listRooms();
  let length = 4;
  if (rooms.length > 2000) {
    length = 5;
  } else if (rooms.length > 20000) {
    length = 6;
  }

  let newRoomId = generateId(length);
  console.log("Generated new roomId", newRoomId);
  while (rooms.includes(newRoomId)) {
    newRoomId = generateId(length);
  }

  res.json({ roomId: newRoomId });
}
