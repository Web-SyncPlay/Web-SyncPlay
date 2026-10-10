/**
 * Pure helpers for local audio-delay sample accounting.
 * Kept free of Web Audio so unit tests can cover edge cases.
 */

export type AudioSkewPlan = {
  appliedEarlyMs: number
  samplesToDrop: number
  samplesToInsert: number
}

export function msToSamples(ms: number, sampleRate: number): number {
  if (!Number.isFinite(ms) || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return 0
  }
  return Math.max(0, Math.round((ms / 1000) * sampleRate))
}

/**
 * Update drop/insert counters when the desired "audio early" skew changes.
 *
 * Pending opposite work is cancelled first so a quick 0 → -214 → 0 toggle does
 * not leave a residual insert after an unapplied drop (or vice versa).
 */
export function planEarlySkewChange(
  current: AudioSkewPlan,
  targetEarlyMs: number,
  sampleRate: number,
): AudioSkewPlan {
  const safeTarget = Math.max(0, targetEarlyMs)
  const deltaMs = safeTarget - current.appliedEarlyMs
  let samplesToDrop = current.samplesToDrop
  let samplesToInsert = current.samplesToInsert

  if (deltaMs > 0) {
    const samples = msToSamples(deltaMs, sampleRate)
    if (samplesToInsert >= samples) {
      samplesToInsert -= samples
    } else {
      const remaining = samples - samplesToInsert
      samplesToInsert = 0
      samplesToDrop += remaining
    }
  } else if (deltaMs < 0) {
    const samples = msToSamples(-deltaMs, sampleRate)
    if (samplesToDrop >= samples) {
      samplesToDrop -= samples
    } else {
      const remaining = samples - samplesToDrop
      samplesToDrop = 0
      samplesToInsert += remaining
    }
  }

  return {
    appliedEarlyMs: safeTarget,
    samplesToDrop,
    samplesToInsert,
  }
}

export type StereoFrame = { left: number; right: number }

/**
 * True when the negative-skew ScriptProcessor path can be torn down safely:
 * no early offset requested, no pending drop/insert work, and no residual frames.
 */
export function shouldLeaveNegativePath(state: {
  delayMs: number
  appliedEarlyMs: number
  samplesToDrop: number
  samplesToInsert: number
  pendingFrames: number
  negativePathActive: boolean
}): boolean {
  return (
    state.negativePathActive &&
    state.delayMs >= 0 &&
    state.appliedEarlyMs === 0 &&
    state.samplesToDrop === 0 &&
    state.samplesToInsert === 0 &&
    state.pendingFrames === 0
  )
}

/**
 * Process one ScriptProcessor quantum:
 * append input → apply pending drops → fill output with inserts/passthrough.
 */
export function processSkewQuantum(input: {
  frames: StereoFrame[]
  pending: StereoFrame[]
  samplesToDrop: number
  samplesToInsert: number
  outputFrameCount: number
}): {
  pending: StereoFrame[]
  output: StereoFrame[]
  samplesToDrop: number
  samplesToInsert: number
} {
  const pending = input.pending.slice()
  for (const frame of input.frames) {
    pending.push(frame)
  }

  let samplesToDrop = input.samplesToDrop
  while (samplesToDrop > 0 && pending.length > 0) {
    pending.shift()
    samplesToDrop -= 1
  }

  let samplesToInsert = input.samplesToInsert
  const output: StereoFrame[] = []
  for (let i = 0; i < input.outputFrameCount; i += 1) {
    if (samplesToInsert > 0) {
      output.push({ left: 0, right: 0 })
      samplesToInsert -= 1
      continue
    }
    const next = pending.shift()
    output.push(next ?? { left: 0, right: 0 })
  }

  return { pending, output, samplesToDrop, samplesToInsert }
}
