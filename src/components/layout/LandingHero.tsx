"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { env } from "@/env"
import { randomRoomId } from "@/lib/room-utils"
import { cn } from "@/lib/utils"
import {
  ArrowRight,
  Dice5,
  GitPullRequest,
  ListVideo,
  Lock,
  Music2,
  Play,
  ShieldCheck,
  Users,
} from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react"

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

const featureCards = [
  {
    title: "Synced playback",
    description:
      "Play, pause, and seek events stay coordinated across the room.",
    icon: Music2,
  },
  {
    title: "Built for group watch",
    description: "Invite friends quickly with one shareable room link.",
    icon: Users,
  },
  {
    title: "Shared queue",
    description: "Keep the session flowing with one collaborative playlist.",
    icon: ListVideo,
  },
  {
    title: "No signup required",
    description: "Guests can join with a link or room name in seconds.",
    icon: Lock,
  },
  {
    title: "Open-source",
    description:
      "Code is publicly available for transparency and community review.",
    icon: GitPullRequest,
  },
  {
    title: "Room control options",
    description:
      "Choose dedicated views for room, player embed, and control embed.",
    icon: ShieldCheck,
  },
]

function FeatureCard(props: {
  feature: (typeof featureCards)[number]
}) {
  const { feature } = props
  return (
    <Card className="h-full w-[min(18rem,70vw)] shrink-0 border-border/70 bg-card/70 backdrop-blur-sm">
      <CardContent className="flex h-full items-start gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background/60">
          <feature.icon className="size-5" />
        </div>
        <div className="min-w-0 text-left">
          <p className="font-medium tracking-tight">{feature.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {feature.description}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function FeatureMarquee() {
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        maskImage:
          "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        WebkitMaskImage:
          "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
      }}
    >
      <div
        className="animate-marquee flex w-max py-1 hover:[animation-play-state:paused] motion-reduce:animate-none"
        aria-label="Product features"
      >
        <ul className="flex shrink-0 gap-3 pr-3">
          {featureCards.map((feature) => (
            <li key={feature.title}>
              <FeatureCard feature={feature} />
            </li>
          ))}
        </ul>
        <ul className="flex shrink-0 gap-3 pr-3" aria-hidden>
          {featureCards.map((feature) => (
            <li key={`loop-${feature.title}`}>
              <FeatureCard feature={feature} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
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

  const shuffleRoomId = useCallback(() => {
    setRoomInput(randomRoomId())
  }, [])

  const handleEnterRoom = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault()
      const id = parseRoomId(roomInput)
      if (!id) return
      router.push(`/room/${encodeURIComponent(id)}`)
    },
    [roomInput, router],
  )

  return (
    <section className="relative isolate flex h-[calc(100dvh-6.5rem)] w-full flex-col overflow-hidden sm:h-[calc(100dvh-4.5rem)]">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,oklch(0.55_0.22_264/0.25),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-size-[48px_48px]"
        aria-hidden
      />
      <div
        className="animate-blob pointer-events-none absolute -top-32 -left-24 h-112 w-md rounded-full bg-linear-to-br from-violet-500/35 via-fuchsia-500/25 to-transparent blur-3xl"
        aria-hidden
      />
      <div
        className="animate-blob animation-delay-2000 pointer-events-none absolute top-1/2 -right-32 h-104 w-104 -translate-y-1/2 rounded-full bg-linear-to-bl from-cyan-500/30 via-blue-500/20 to-transparent blur-3xl"
        aria-hidden
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-5 px-6 pt-[8vh] text-center sm:gap-7 sm:pt-[12vh]">
          <Link
            href="/"
            className="flex flex-col items-center gap-3 sm:gap-4"
          >
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

        <div className="mt-auto w-full shrink-0 pb-3 pt-4 sm:pb-4">
          <FeatureMarquee />
        </div>
      </div>
    </section>
  )
}
