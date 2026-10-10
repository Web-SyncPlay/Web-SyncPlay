import { formatClockMs } from "@/shared/time-format"

export function RemoteSeekOverlay(props: {
  remoteSeekerName: string
  seekProgressPercent: number
  remoteSeekTargetMs: number
  totalTimeLabel: string
}) {
  const {
    remoteSeekerName,
    seekProgressPercent,
    remoteSeekTargetMs,
    totalTimeLabel,
  } = props
  return (
    <div className="absolute inset-0 z-30 flex items-end bg-black/55 p-4 transition-opacity duration-200">
      <div className="w-full rounded-md border border-white/20 bg-black/70 px-4 py-3 text-white">
        <div className="mb-2 text-xs font-medium uppercase tracking-wider text-white/80">
          <span className="inline-flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white/80" />
            {remoteSeekerName} is seeking
          </span>
        </div>
        <div className="relative h-2 w-full rounded-full bg-white/20">
          <div
            className="absolute left-0 top-0 h-2 rounded-full bg-white/80 transition-[width] duration-75"
            style={{ width: `${seekProgressPercent}%` }}
          />
          <div
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-white shadow"
            style={{ left: `${seekProgressPercent}%` }}
          />
        </div>
        <div className="mt-2 text-right text-sm text-white/90">
          {formatClockMs(remoteSeekTargetMs)} / {totalTimeLabel}
        </div>
      </div>
    </div>
  )
}
