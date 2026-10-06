"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { CheckCircle2, Loader2, Search, XCircle } from "lucide-react"
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
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${m}:${String(s).padStart(2, "0")}`
}

export function LandingUrlTester(): React.JSX.Element {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)

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
      className="relative isolate w-full overflow-hidden border-t border-white/5 px-6 py-16 sm:py-20"
    >
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_100%,oklch(0.5_0.14_210/0.18),transparent)]"
        aria-hidden
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 text-center">
        <div className="flex flex-col items-center gap-2">
          <h2 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            Will it play?
          </h2>
          <p className="max-w-md text-sm text-muted-foreground sm:text-base">
            Paste a YouTube, Vimeo, direct file, or site URL — we&apos;ll check
            if Web-SyncPlay can play and sync it.
          </p>
        </div>

        <form
          onSubmit={handleCheck}
          className="flex w-full flex-col gap-3"
        >
          <div className="flex w-full items-center gap-2 rounded-2xl border border-input bg-background/70 px-3 py-2.5 shadow-lg shadow-black/20 backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 sm:px-4 sm:py-3">
            <Input
              type="text"
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              aria-label="Media URL to check"
              autoComplete="off"
              spellCheck={false}
              className="h-12 min-w-0 flex-1 border-0 bg-transparent px-2 text-base shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
            />
            <Button
              type="submit"
              size="lg"
              className="shrink-0 gap-1.5"
              disabled={!ready || loading}
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Search />
              )}
              <span className="hidden sm:inline">Check</span>
            </Button>
          </div>
        </form>

        <div
          aria-live="polite"
          className="min-h-16 w-full"
        >
          {error && (
            <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {result && (
            <div
              className={cn(
                "animate-in fade-in-0 slide-in-from-bottom-1 flex w-full flex-col gap-2 rounded-xl border px-4 py-4 text-left duration-300",
                result.playable
                  ? "border-teal-500/35 bg-teal-500/10"
                  : "border-destructive/40 bg-destructive/10",
              )}
            >
              <div className="flex items-start gap-2.5">
                {result.playable ? (
                  <CheckCircle2
                    className="mt-0.5 size-5 shrink-0 text-teal-400"
                    aria-hidden
                  />
                ) : (
                  <XCircle
                    className="mt-0.5 size-5 shrink-0 text-destructive"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-medium tracking-tight">
                    {result.playable ? "Playable & syncable" : "Not playable"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {result.message}
                  </p>
                  {result.title && result.title !== result.url && (
                    <p className="truncate text-sm text-foreground/90">
                      {result.title}
                    </p>
                  )}
                  {result.playable && (
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
                          <dd className="text-foreground/80">{durationLabel}</dd>
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
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
