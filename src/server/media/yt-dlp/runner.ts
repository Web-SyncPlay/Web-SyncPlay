import { env } from "@/env"
import { spawn } from "node:child_process"

let activeCount = 0
const waitQueue: Array<() => void> = []

async function acquireSlot() {
  if (activeCount < env.YTDLP_MAX_CONCURRENT) {
    activeCount += 1
    return
  }
  await new Promise<void>((resolve) => {
    waitQueue.push(() => {
      activeCount += 1
      resolve()
    })
  })
}

function releaseSlot() {
  activeCount -= 1
  const next = waitQueue.shift()
  if (next) next()
}

export type YtDlpRunResult = {
  code: number
  stdout: string
  stderr: string
}

/**
 * Runs yt-dlp with bounded concurrency across the process.
 */
export async function runYtDlp(args: string[]): Promise<YtDlpRunResult> {
  await acquireSlot()
  try {
    return await runYtDlpInner(args)
  } finally {
    releaseSlot()
  }
}

async function runYtDlpInner(args: string[]): Promise<YtDlpRunResult> {
  return await new Promise((resolve) => {
    const proc = spawn(env.YTDLP_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    const timer = setTimeout(() => {
      try {
        proc.kill("SIGKILL")
      } catch {
        // ignore
      }
    }, env.YTDLP_TIMEOUT_MS)

    proc.on("close", (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    proc.on("error", () => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr })
    })
  })
}
