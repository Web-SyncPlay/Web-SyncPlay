import { getRoom, listRooms } from "../../lib/cache"
import { NextApiRequest, NextApiResponse } from "next"

export default async function debug(_: NextApiRequest, res: NextApiResponse) {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).end()
  }

  res.json(
    await Promise.all(
      (await listRooms()).map(async (room) => await getRoom(room))
    )
  )
}
