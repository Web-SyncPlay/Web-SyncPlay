"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { randomRoomId } from "@/shared/room-utils"
import { formatDurationSeconds } from "@/shared/time-format"
import { cn } from "@/components/lib/utils"
import { CheckCircle2, Loader2, Play, Search, XCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

type CheckResult =
  | {
      playable: true
      url: string
      title: string
      playbackMode: "direct" | "relay"
      durationSeconds: number | null
      isLive: boolean | null
      native: boolean
      streamCount: number
      message: string
    }
  | {
      playable: false
      url: string
      title?: string
      failureReason?: string
      message: string
    }

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null
  return formatDurationSeconds(Math.round(seconds))
}

export function LandingUrlTester(): React.JSX.Element {
  const router = useRouter()
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)

  function handleCreateRoom() {
    if (!result?.playable) return
    const roomId = randomRoomId()
    router.push(
      `/room/${encodeURIComponent(roomId)}?media=${encodeURIComponent(result.url)}`,
    )
  }

  async function handleCheck(event?: FormEvent) {
    event?.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || loading) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/media/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = (await response.json()) as CheckResult & { error?: string }

      if (!response.ok) {
        setError(data.error ?? "Could not check this URL.")
        return
      }

      setResult(data)
    } catch {
      setError("Network error — try again in a moment.")
    } finally {
      setLoading(false)
    }
  }

  const ready = Boolean(url.trim())
  const durationLabel =
    result?.playable === true ? formatDuration(result.durationSeconds) : null

  return (
    <section
      id="url-check"
      className="relative w-full shrink-0 border-t border-white/5 px-6 pt-8 pb-10 sm:pt-10 sm:pb-12"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[#020617]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_100%,oklch(0.5_0.14_210/0.22),transparent)]"
        aria-hidden
      />

      <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-4 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <h2 className="font-heading text-lg font-semibold tracking-tight sm:text-xl">
            Will it play?
          </h2>
          <p className="max-w-md text-xs text-muted-foreground sm:text-sm">
            Paste a media URL to check if it can play and sync here.
          </p>
        </div>

        <form onSubmit={handleCheck} className="w-full">
          <div className="flex w-full items-center gap-2 rounded-2xl border border-input bg-background/70 px-3 py-1.5 shadow-lg shadow-black/20 backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 sm:px-4 sm:py-2">
            <Input
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              aria-label="Media URL to check"
              autoComplete="off"
              spellCheck={false}
              className="h-10 min-w-0 flex-1 border-0 bg-transparent px-2 text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 sm:text-base dark:bg-transparent"
            />
            <Button
              type="submit"
              size="default"
              className="shrink-0 gap-1.5"
              disabled={!ready || loading}
              aria-label={loading ? "Checking URL" : "Check URL"}
            >
              {loading ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <Search aria-hidden />
              )}
              <span className="hidden sm:inline">Check</span>
            </Button>
          </div>
        </form>

        {(error || result) && (
          <div aria-live="polite" className="w-full">
            {error && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            {result && (
              <div
                className={cn(
                  "animate-in fade-in-0 slide-in-from-bottom-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left duration-300",
                  result.playable
                    ? "border-teal-500/35 bg-teal-500/10"
                    : "border-destructive/40 bg-destructive/10",
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {result.playable ? (
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-teal-400"
                      aria-hidden
                    />
                  ) : (
                    <XCircle
                      className="mt-0.5 size-4 shrink-0 text-destructive"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium tracking-tight">
                      {result.playable
                        ? "Playable & syncable"
                        : "Not playable"}
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {result.message}
                    </p>
                    {result.title && result.title !== result.url && (
                      <p className="truncate text-xs text-foreground/90 sm:text-sm">
                        {result.title}
                      </p>
                    )}
                    {result.playable && (
                      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <div className="flex gap-1">
                          <dt className="opacity-70">Mode</dt>
                          <dd className="capitalize text-foreground/80">
                            {result.native
                              ? "native"
                              : result.playbackMode === "relay"
                                ? "proxy"
                                : "direct"}
                          </dd>
                        </div>
                        {durationLabel && (
                          <div className="flex gap-1">
                            <dt className="opacity-70">Length</dt>
                            <dd className="text-foreground/80">
                              {durationLabel}
                            </dd>
                          </div>
                        )}
                        {result.isLive && (
                          <div className="flex gap-1">
                            <dt className="opacity-70">Type</dt>
                            <dd className="text-foreground/80">Live</dd>
                          </div>
                        )}
                        {result.streamCount > 1 && (
                          <div className="flex gap-1">
                            <dt className="opacity-70">Streams</dt>
                            <dd className="text-foreground/80">
                              {result.streamCount}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                </div>
                {result.playable && (
                  <Button
                    type="button"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={handleCreateRoom}
                  >
                    <Play />
                    Create room
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
