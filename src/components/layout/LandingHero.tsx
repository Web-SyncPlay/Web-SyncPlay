"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { env } from "@/env"
import { randomRoomId } from "@/lib/room-utils"
import { cn } from "@/lib/utils"
import { ArrowRight, Dice5, Play } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

function parseRoomId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const pathMatch = trimmed.match(/\/room\/([^/?#]+)/i)
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1])
    } catch {
      return pathMatch[1]
    }
  }

  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed)
      const fromPath = url.pathname.match(/\/room\/([^/]+)/i)
      if (fromPath?.[1]) {
        try {
          return decodeURIComponent(fromPath[1])
        } catch {
          return fromPath[1]
        }
      }
    }
  } catch {
    // not a valid URL
  }

  const bare = trimmed.replace(/^\/+|\/+$/g, "")
  return bare || null
}

function RoomEntry(props: {
  roomInput: string
  onRoomInputChange: (value: string) => void
  onShuffle: () => void
  onSubmit: (event?: FormEvent) => void
  className?: string
}) {
  const { roomInput, onRoomInputChange, onShuffle, onSubmit, className } =
    props
  const ready = Boolean(parseRoomId(roomInput))

  return (
    <form
      onSubmit={onSubmit}
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <div className="flex w-full items-center gap-2 rounded-2xl border border-input bg-background/70 px-3 py-2.5 shadow-lg shadow-black/20 backdrop-blur-md transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40 sm:px-4 sm:py-3">
        <Input
          type="text"
          value={roomInput}
          onChange={(event) => onRoomInputChange(event.target.value)}
          placeholder="Room name or link"
          aria-label="Room name or link"
          autoComplete="off"
          spellCheck={false}
          className="h-12 min-w-0 flex-1 border-0 bg-transparent px-2 text-lg shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-xl dark:bg-transparent"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-lg"
          className="shrink-0"
          onClick={onShuffle}
          aria-label="Shuffle a new room name"
        >
          <Dice5 />
        </Button>
        <Button
          type="submit"
          size="lg"
          className="shrink-0 gap-1.5"
          disabled={!ready}
        >
          <Play />
          <span className="hidden sm:inline">Go</span>
          <ArrowRight className="sm:hidden" />
        </Button>
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Type a room name to create or join — or paste a room link.
      </p>
    </form>
  )
}

export function LandingHero(): React.JSX.Element {
  const [roomInput, setRoomInput] = useState("")
  const router = useRouter()

  useEffect(() => {
    setRoomInput(randomRoomId())
  }, [])

  function shuffleRoomId() {
    setRoomInput(randomRoomId())
  }

  function handleEnterRoom(event?: FormEvent) {
    event?.preventDefault()
    const id = parseRoomId(roomInput)
    if (!id) return
    router.push(`/room/${encodeURIComponent(id)}`)
  }

  return (
    <section className="relative isolate flex h-[calc(100dvh-5.5rem)] w-full flex-col overflow-hidden sm:h-[calc(100dvh-3.75rem)]">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,oklch(0.55_0.18_230/0.22),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-size-[48px_48px]"
        aria-hidden
      />
      <div
        className="animate-blob pointer-events-none absolute -top-32 -left-24 h-112 w-md rounded-full bg-linear-to-br from-sky-500/30 via-teal-500/20 to-transparent blur-3xl"
        aria-hidden
      />
      <div
        className="animate-blob animation-delay-2000 pointer-events-none absolute top-1/2 -right-32 h-104 w-104 -translate-y-1/2 rounded-full bg-linear-to-bl from-cyan-500/25 via-blue-500/15 to-transparent blur-3xl"
        aria-hidden
      />

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-5 px-6 pb-16 text-center sm:gap-7">
        <Link href="/" className="flex flex-col items-center gap-3 sm:gap-4">
          <Image
            src="/logo_white.png"
            alt="Web-SyncPlay logo"
            width={112}
            height={112}
            className="size-20 sm:size-28"
            priority
          />
          <span className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
            {env.NEXT_PUBLIC_APP_NAME}
          </span>
        </Link>

        <h1 className="max-w-xl text-lg leading-snug font-medium tracking-tight text-muted-foreground sm:text-2xl lg:text-3xl">
          Sync movie nights and playlists with friends in seconds
        </h1>

        <RoomEntry
          roomInput={roomInput}
          onRoomInputChange={setRoomInput}
          onShuffle={shuffleRoomId}
          onSubmit={handleEnterRoom}
          className="animate-in fade-in-0 slide-in-from-bottom-2 duration-700"
        />
      </div>
    </section>
  )
}
