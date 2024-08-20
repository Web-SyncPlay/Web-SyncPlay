import { type NextApiRequest, type NextApiResponse } from "next"
import { wipeCache } from "~/lib/cache/redis"

export default async function generate(
  _: NextApiRequest,
  res: NextApiResponse
) {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).end()
  }

  await wipeCache()
  res.send("Ok")
}
