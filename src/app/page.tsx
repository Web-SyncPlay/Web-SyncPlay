import { LandingHero } from "@/components/layout/LandingHero"
import { LandingUrlTester } from "@/components/layout/LandingUrlTester"

export default function LandingPage() {
  return (
    <div className="relative isolate flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <div
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        aria-hidden
      >
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,oklch(0.55_0.18_230/0.22),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(1_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,oklch(1_0_0/0.04)_1px,transparent_1px)] bg-size-[48px_48px]" />
        <div className="animate-blob absolute -top-32 -left-24 h-112 w-md rounded-full bg-linear-to-br from-sky-500/30 via-teal-500/20 to-transparent blur-3xl" />
        <div className="animate-blob animation-delay-2000 absolute top-1/2 -right-32 h-104 w-104 -translate-y-1/2 rounded-full bg-linear-to-bl from-cyan-500/25 via-blue-500/15 to-transparent blur-3xl" />
      </div>

      <LandingHero />
      <LandingUrlTester />
    </div>
  )
}
