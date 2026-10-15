"use client"

import {
  canUseFileSystemAccess,
  pickLocalMediaFileWithFsa,
} from "@/client/local-media/local-media-handles"
import { stashLandingLocalMediaHandoff } from "@/client/local-media/local-media-landing-handoff"
import {
  formatFileSizeBytes,
  probeLocalFilePlayability,
  type LocalPlayabilityResult,
} from "@/client/local-media/local-media-playability-probe"
import { cn } from "@/components/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { randomRoomId } from "@/shared/room-utils"
import { formatDurationSeconds } from "@/shared/time-format"
import {
  CheckCircle2,
  FileVideo,
  Loader2,
  Play,
  Search,
  Upload,
  X,
  XCircle,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, type DragEvent, type FormEvent } from "react"

type CheckMode = "url" | "local"

type UrlCheckResult =
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

function ModeSegment(props: {
  mode: CheckMode
  onModeChange: (mode: CheckMode) => void
}) {
  const { mode, onModeChange } = props
  return (
    <div
      role="tablist"
      aria-label="Check media type"
      className="flex w-full max-w-xs rounded-xl bg-white/5 p-1 sm:max-w-sm"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === "url"}
        id="media-check-tab-url"
        className={cn(
          "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
          mode === "url"
            ? "bg-background/90 text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onModeChange("url")}
      >
        URL
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "local"}
        id="media-check-tab-local"
        className={cn(
          "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
          mode === "local"
            ? "bg-background/90 text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => onModeChange("local")}
      >
        <span className="sm:hidden">Local</span>
        <span className="hidden sm:inline">Local file</span>
      </button>
    </div>
  )
}

export function LandingMediaTester(): React.JSX.Element {
  const router = useRouter()
  const localFileInputRef = useRef<HTMLInputElement>(null)

  const [mode, setMode] = useState<CheckMode>("url")

  const [url, setUrl] = useState("")
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [urlResult, setUrlResult] = useState<UrlCheckResult | null>(null)

  const [localFile, setLocalFile] = useState<File | null>(null)
  const [localHandle, setLocalHandle] = useState<
    FileSystemFileHandle | undefined
  >(undefined)
  const [localLoading, setLocalLoading] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [localResult, setLocalResult] = useState<LocalPlayabilityResult | null>(
    null,
  )
  const [dragOver, setDragOver] = useState(false)

  function clearUrlState() {
    setUrlError(null)
    setUrlResult(null)
  }

  function clearLocalState() {
    setLocalError(null)
    setLocalResult(null)
    setLocalFile(null)
    setLocalHandle(undefined)
    if (localFileInputRef.current) localFileInputRef.current.value = ""
  }

  function handleModeChange(next: CheckMode) {
    if (next === mode) return
    setMode(next)
    if (next === "url") clearLocalState()
    else clearUrlState()
  }

  function handleCreateRoomFromUrl() {
    if (!urlResult?.playable) return
    const roomId = randomRoomId()
    router.push(
      `/room/${encodeURIComponent(roomId)}?media=${encodeURIComponent(urlResult.url)}`,
    )
  }

  function handleCreateRoomFromLocal() {
    if (!localResult?.playable || !localFile) return
    const roomId = randomRoomId()
    // skipDefaultMedia travels in the in-memory handoff — avoid `?local=1`
    // so searchParams never remount the room client / drop the WebSocket.
    stashLandingLocalMediaHandoff(roomId, localFile, localHandle)
    router.push(`/room/${encodeURIComponent(roomId)}`)
  }

  async function handleUrlCheck(event?: FormEvent) {
    event?.preventDefault()
    const trimmed = url.trim()
    if (!trimmed || urlLoading) return

    setUrlLoading(true)
    setUrlError(null)
    setUrlResult(null)

    try {
      const response = await fetch("/api/media/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = (await response.json()) as UrlCheckResult & {
        error?: string
      }

      if (!response.ok) {
        setUrlError(data.error ?? "Could not check this URL.")
        return
      }

      setUrlResult(data)
    } catch {
      setUrlError("Network error — try again in a moment.")
    } finally {
      setUrlLoading(false)
    }
  }

  async function runLocalProbe(
    file: File,
    handle?: FileSystemFileHandle,
  ): Promise<void> {
    setLocalFile(file)
    setLocalHandle(handle)
    setLocalLoading(true)
    setLocalError(null)
    setLocalResult(null)
    try {
      const result = await probeLocalFilePlayability(file)
      setLocalResult(result)
    } catch (error) {
      console.error("[landing] local file playability probe failed", error)
      setLocalError("Could not check this file.")
    } finally {
      setLocalLoading(false)
    }
  }

  async function onChooseLocalFile() {
    if (localLoading) return
    if (canUseFileSystemAccess()) {
      try {
        const picked = await pickLocalMediaFileWithFsa()
        if (!picked) return
        await runLocalProbe(picked.file, picked.handle)
        return
      } catch (error) {
        console.warn(
          "[landing] File System Access failed; falling back to input",
          error,
        )
      }
    }
    localFileInputRef.current?.click()
  }

  function onLocalInputChange(file: File | undefined) {
    if (!file) return
    void runLocalProbe(file)
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    if (localLoading) return
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    void runLocalProbe(file)
  }

  const urlReady = Boolean(url.trim())
  const urlDurationLabel =
    urlResult?.playable === true
      ? formatDuration(urlResult.durationSeconds)
      : null
  const localDurationLabel =
    localResult?.playable === true
      ? formatDuration(localResult.durationSeconds)
      : null

  const showUrlFeedback = mode === "url" && (urlError || urlResult)
  const showLocalFeedback =
    mode === "local" && (localError || localResult || localLoading)

  return (
    <section
      id="media-check"
      className="relative w-full shrink-0 border-t border-white/5 px-6 pt-8 pb-10 sm:pt-10 sm:pb-12"
    >
      {/* Bookmark / deep-link alias for the previous URL-check section id */}
      <span id="url-check" className="sr-only" aria-hidden />
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
            Check a link or a file before you start a room.
          </p>
        </div>

        <ModeSegment mode={mode} onModeChange={handleModeChange} />

        {mode === "url" ? (
          <form
            onSubmit={handleUrlCheck}
            className="w-full"
            aria-labelledby="media-check-tab-url"
          >
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
                disabled={!urlReady || urlLoading}
                aria-label={urlLoading ? "Checking URL" : "Check URL"}
              >
                {urlLoading ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Search aria-hidden />
                )}
                <span className="hidden sm:inline">Check</span>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
              Paste a media URL to check if it can play and sync here.
            </p>
          </form>
        ) : (
          <div className="w-full" aria-labelledby="media-check-tab-local">
            <div
              onDragEnter={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={(event) => {
                event.preventDefault()
                if (event.currentTarget.contains(event.relatedTarget as Node)) {
                  return
                }
                setDragOver(false)
              }}
              onDrop={onDrop}
              className={cn(
                "flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed bg-background/70 px-4 py-4 shadow-lg shadow-black/20 backdrop-blur-md transition-[border-color,box-shadow,background-color] sm:min-h-28",
                dragOver
                  ? "border-ring bg-teal-500/10 ring-3 ring-ring/40"
                  : "border-input",
              )}
            >
              {localFile ? (
                <div className="flex w-full max-w-md items-center gap-2 text-left">
                  <FileVideo
                    className="size-5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {localFile.name || "Local media"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSizeBytes(localFile.size)}
                      {localLoading ? " · Checking…" : null}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear selected file"
                    disabled={localLoading}
                    onClick={(event) => {
                      event.stopPropagation()
                      clearLocalState()
                    }}
                  >
                    <X aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={localLoading}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onChooseLocalFile()
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <>
                  <Upload
                    className="size-5 text-muted-foreground"
                    aria-hidden
                  />
                  <p className="text-sm text-foreground/90">
                    Drop a video or audio file here
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={localLoading}
                    onClick={(event) => {
                      event.stopPropagation()
                      void onChooseLocalFile()
                    }}
                  >
                    Choose file
                  </Button>
                </>
              )}
            </div>
            <input
              ref={localFileInputRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              data-testid="landing-local-file-input"
              onChange={(event) => {
                onLocalInputChange(event.target.files?.[0])
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground sm:text-sm">
              Your file stays on this device. Others stream it from your browser
              in a room.
            </p>
          </div>
        )}

        {(showUrlFeedback || showLocalFeedback) && (
          <div aria-live="polite" className="w-full">
            {mode === "url" && urlError && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {urlError}
              </p>
            )}

            {mode === "local" && localError && (
              <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {localError}
              </p>
            )}

            {mode === "local" &&
              localLoading &&
              !localResult &&
              !localError && (
                <div className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-sm text-muted-foreground">
                  <Loader2
                    className="size-4 shrink-0 animate-spin"
                    aria-hidden
                  />
                  Checking file in this browser…
                </div>
              )}

            {mode === "url" && urlResult && (
              <div
                className={cn(
                  "animate-in fade-in-0 slide-in-from-bottom-1 flex w-full flex-col gap-3 rounded-xl border px-3 py-2.5 text-left duration-300 sm:flex-row sm:items-center",
                  urlResult.playable
                    ? "border-teal-500/35 bg-teal-500/10"
                    : "border-destructive/40 bg-destructive/10",
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {urlResult.playable ? (
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
                      {urlResult.playable
                        ? "Playable & syncable"
                        : urlResult.failureReason === "unsupported_format"
                          ? "Unsupported format"
                          : urlResult.failureReason === "metadata_failed"
                            ? "Could not extract media"
                            : urlResult.failureReason === "cors_blocked"
                              ? "Blocked by CORS"
                              : urlResult.failureReason === "source_unreachable"
                                ? "Source unreachable"
                                : "Not playable"}
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {urlResult.message}
                    </p>
                    {urlResult.title && urlResult.title !== urlResult.url && (
                      <p className="truncate text-xs text-foreground/90 sm:text-sm">
                        {urlResult.title}
                      </p>
                    )}
                    {urlResult.playable && (
                      <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <div className="flex gap-1">
                          <dt className="opacity-70">Mode</dt>
                          <dd className="capitalize text-foreground/80">
                            {urlResult.native
                              ? "native"
                              : urlResult.playbackMode === "relay"
                                ? "proxy"
                                : "direct"}
                          </dd>
                        </div>
                        {urlDurationLabel && (
                          <div className="flex gap-1">
                            <dt className="opacity-70">Length</dt>
                            <dd className="text-foreground/80">
                              {urlDurationLabel}
                            </dd>
                          </div>
                        )}
                        {urlResult.isLive && (
                          <div className="flex gap-1">
                            <dt className="opacity-70">Type</dt>
                            <dd className="text-foreground/80">Live</dd>
                          </div>
                        )}
                        {urlResult.streamCount > 1 && (
                          <div className="flex gap-1">
                            <dt className="opacity-70">Streams</dt>
                            <dd className="text-foreground/80">
                              {urlResult.streamCount}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                </div>
                {urlResult.playable && (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full shrink-0 gap-1.5 sm:w-auto"
                    onClick={handleCreateRoomFromUrl}
                  >
                    <Play />
                    Create room
                  </Button>
                )}
              </div>
            )}

            {mode === "local" && localResult && (
              <div
                className={cn(
                  "animate-in fade-in-0 slide-in-from-bottom-1 flex w-full flex-col gap-3 rounded-xl border px-3 py-2.5 text-left duration-300 sm:flex-row sm:items-center",
                  localResult.playable
                    ? "border-teal-500/35 bg-teal-500/10"
                    : "border-destructive/40 bg-destructive/10",
                )}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  {localResult.playable ? (
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
                      {localResult.playable
                        ? "Playable in this browser"
                        : localResult.failureReason === "unsupported_type"
                          ? "Unsupported type"
                          : localResult.failureReason === "empty"
                            ? "Empty file"
                            : "Won’t play in this browser"}
                    </p>
                    <p className="text-xs text-muted-foreground sm:text-sm">
                      {localResult.message}
                    </p>
                    <p className="truncate text-xs text-foreground/90 sm:text-sm">
                      {localResult.fileName}
                    </p>
                    <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      {localResult.playable && (
                        <>
                          <div className="flex gap-1">
                            <dt className="opacity-70">Type</dt>
                            <dd className="text-foreground/80">
                              {localResult.kind} · {localResult.mimeType}
                            </dd>
                          </div>
                          {localDurationLabel && (
                            <div className="flex gap-1">
                              <dt className="opacity-70">Length</dt>
                              <dd className="text-foreground/80">
                                {localDurationLabel}
                              </dd>
                            </div>
                          )}
                          <div className="flex gap-1">
                            <dt className="opacity-70">Size</dt>
                            <dd className="text-foreground/80">
                              {formatFileSizeBytes(localResult.sizeBytes)}
                            </dd>
                          </div>
                        </>
                      )}
                      <div className="flex gap-1">
                        <dt className="opacity-70">Service Worker</dt>
                        <dd className="text-foreground/80">
                          {localResult.swAvailable
                            ? "available"
                            : "not available"}
                        </dd>
                      </div>
                      <div className="flex gap-1">
                        <dt className="opacity-70">File System Access</dt>
                        <dd className="text-foreground/80">
                          {localResult.fsaAvailable
                            ? "available"
                            : "not available — re-pick after refresh"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                {localResult.playable && (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full shrink-0 gap-1.5 sm:w-auto"
                    onClick={handleCreateRoomFromLocal}
                  >
                    <Play />
                    Create room with this file
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

/** @deprecated Prefer {@link LandingMediaTester} */
export { LandingMediaTester as LandingUrlTester }
