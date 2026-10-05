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

/** Cap yt-dlp stdout/stderr so a huge dump cannot OOM the process. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

async function runYtDlpInner(args: string[]): Promise<YtDlpRunResult> {
  return await new Promise((resolve) => {
    const proc = spawn(env.YTDLP_BIN, args, {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let truncated = false

    const appendCapped = (target: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString()
      if (target === "stdout") {
        if (stdout.length + text.length > MAX_OUTPUT_BYTES) {
          truncated = true
          stdout = stdout.slice(0, MAX_OUTPUT_BYTES)
          try {
            proc.kill("SIGKILL")
          } catch {
            // ignore
          }
          return
        }
        stdout += text
        return
      }
      if (stderr.length + text.length > MAX_OUTPUT_BYTES) {
        truncated = true
        stderr = stderr.slice(0, MAX_OUTPUT_BYTES)
        return
      }
      stderr += text
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      appendCapped("stdout", chunk)
    })
    proc.stderr.on("data", (chunk: Buffer) => {
      appendCapped("stderr", chunk)
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
      if (truncated && !stderr.includes("output truncated")) {
        stderr = `${stderr}\nyt-dlp output truncated after ${MAX_OUTPUT_BYTES} bytes`.trim()
      }
      resolve({ code: code ?? 1, stdout, stderr })
    })
    proc.on("error", () => {
      clearTimeout(timer)
      resolve({ code: 1, stdout, stderr })
    })
  })
}
