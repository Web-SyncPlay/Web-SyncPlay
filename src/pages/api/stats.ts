import { countRooms, countUsers } from "~/lib/cache/redis"
import { type NextApiRequest, type NextApiResponse } from "next"

export default async function stats(_: NextApiRequest, res: NextApiResponse) {
  res.send({ rooms: await countRooms(), users: await countUsers() })
}
