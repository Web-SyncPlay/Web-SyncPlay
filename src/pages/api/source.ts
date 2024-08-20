import { type NextApiRequest, type NextApiResponse } from "next"
import { isUrl, shellSanitizeUrl } from "~/lib/utils"
import { exec, type ExecException } from "child_process"
import * as util from "util"
interface UrlSource {
  error: boolean
  stdout: string
  stderr: string
}

const asyncExec = util.promisify(exec)
const memoizeExtractFromUrl = () => {
  const cache: Record<string, UrlSource | null> = {}
  return async (url: string) => {
    if (url in cache) {
      const cached = cache[url]?? null
      return cached
    }

    if (!isUrl(url)) {
      console.error("Invalid url provided to source video from:", url)
      cache[url] = {
        error: true,
        stdout: "",
        stderr: "Invalid url",
      }
      return cache[url]
    }

    // set pending...
    cache[url] = null

    try {
      cache[url] = {
        error: false,
        ...(await asyncExec("yt-dlp -g " + url))
      }
    } catch (error) {
      const e = error as ExecException
      console.error("Extraction failed", e)
      cache[url] = {
        error: true,
        stdout: "",
        stderr: e.message,
      }
    }

    return cache[url]
  }
}

const extractFromUrl = memoizeExtractFromUrl()

const handleResult = async (url: string, res: NextApiResponse) => {
  const result = await extractFromUrl(url)
  // already pending?
  if (result === null) {
    setTimeout( () => void handleResult(url, res), 100)
    return
  }

  if ("error" in result && result.error) {
    console.error(`exec error: ${result.error}`)
    return res.status(500).send(result.stderr.replace("\n", ""))
  }

  res.json({
    stdout: result.stdout,
    stderr: result.stderr.replace("\n", ""),
  })
}

export default async function source(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const url = shellSanitizeUrl(req.body as string)
  if (!isUrl(url)) {
    return res.status(400).send("Invalid url")
  }
  console.log("Requested video source of", req.body, "sanitized", url)

  await handleResult(url, res)
}
