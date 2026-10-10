import {
  AUDIO_DELAY_MAX_MS,
  clampAudioDelayMs,
} from "@/shared/audio-delay"
import {
  planEarlySkewChange,
  processSkewQuantum,
  shouldLeaveNegativePath,
  type AudioSkewPlan,
  type StereoFrame,
} from "@/shared/audio-delay-skew"

export type LocalAudioDelayGraph = {
  setDelayMs: (delayMs: number) => void
  dispose: () => void
  readonly mediaElement: HTMLMediaElement
  /** Test/debug: whether the ScriptProcessor negative path is connected. */
  isNegativePathActive: () => boolean
}

const PROCESSOR_BUFFER_SIZE = 4096
/** Stereo frames held while inserting silence / pacing drops (~3s @ 48kHz). */
const PENDING_CAPACITY_FRAMES = 48_000 * 3

/**
 * Routes element audio through a local processing graph so A/V offset never
 * touches the synced video playhead.
 *
 * - Positive delay: DelayNode only (no ScriptProcessor latency).
 * - Negative delay: sample drop/insert via ScriptProcessor, then DelayNode.
 * - When early-skew work drains and delay is ≥ 0, the ScriptProcessor is
 *   disconnected so the zero/positive path stays low-latency.
 *
 * `createMediaElementSource` can only run once per element — keep the graph for
 * that element lifetime (quality remounts create a new element).
 */
export function attachLocalAudioDelayGraph(
  mediaElement: HTMLMediaElement,
  initialDelayMs = 0,
): LocalAudioDelayGraph | null {
  if (typeof window === "undefined") {
    return null
  }

  const AudioCtx =
    window.AudioContext ??
    (
      window as unknown as {
        webkitAudioContext?: typeof AudioContext
      }
    ).webkitAudioContext
  if (!AudioCtx) {
    return null
  }

  let context: AudioContext
  let source: MediaElementAudioSourceNode
  try {
    context = new AudioCtx()
    source = context.createMediaElementSource(mediaElement)
  } catch {
    return null
  }

  const delayNode = context.createDelay(AUDIO_DELAY_MAX_MS / 1000)
  let processor: ScriptProcessorNode | null = null

  let delayMs = clampAudioDelayMs(initialDelayMs)
  let skew: AudioSkewPlan = {
    appliedEarlyMs: 0,
    samplesToDrop: 0,
    samplesToInsert: 0,
  }
  let negativePathActive = false
  let pending: StereoFrame[] = []

  const applyPositiveDelay = () => {
    delayNode.delayTime.setValueAtTime(
      Math.max(0, delayMs) / 1000,
      context.currentTime,
    )
  }

  const tearDownNegativeProcessor = () => {
    if (!processor) {
      return
    }
    try {
      processor.onaudioprocess = null
      processor.disconnect()
    } catch {
      // Already disconnected.
    }
    processor = null
  }

  const connectPositivePath = () => {
    try {
      source.disconnect()
      processor?.disconnect()
      delayNode.disconnect()
    } catch {
      // First connect or already disconnected.
    }
    source.connect(delayNode)
    delayNode.connect(context.destination)
    negativePathActive = false
  }

  const maybeLeaveNegativePath = () => {
    if (
      !shouldLeaveNegativePath({
        delayMs,
        appliedEarlyMs: skew.appliedEarlyMs,
        samplesToDrop: skew.samplesToDrop,
        samplesToInsert: skew.samplesToInsert,
        pendingFrames: pending.length,
        negativePathActive,
      })
    ) {
      return
    }
    connectPositivePath()
    tearDownNegativeProcessor()
  }

  const ensureNegativeProcessor = () => {
    if (processor) {
      return processor
    }
    const node = context.createScriptProcessor(PROCESSOR_BUFFER_SIZE, 2, 2)
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer
      const output = event.outputBuffer
      const frames = input.length
      const leftIn = input.getChannelData(0)
      const rightIn =
        input.numberOfChannels > 1 ? input.getChannelData(1) : leftIn
      const leftOut = output.getChannelData(0)
      const rightOut =
        output.numberOfChannels > 1 ? output.getChannelData(1) : leftOut

      const inputFrames: StereoFrame[] = []
      for (let i = 0; i < frames; i += 1) {
        inputFrames.push({ left: leftIn[i]!, right: rightIn[i]! })
      }

      // Bound pending growth if the user stacks large inserts.
      if (pending.length > PENDING_CAPACITY_FRAMES) {
        pending = pending.slice(pending.length - PENDING_CAPACITY_FRAMES)
      }

      const processed = processSkewQuantum({
        frames: inputFrames,
        pending,
        samplesToDrop: skew.samplesToDrop,
        samplesToInsert: skew.samplesToInsert,
        outputFrameCount: frames,
      })
      pending = processed.pending
      skew = {
        ...skew,
        samplesToDrop: processed.samplesToDrop,
        samplesToInsert: processed.samplesToInsert,
      }

      for (let i = 0; i < frames; i += 1) {
        const frame = processed.output[i] ?? { left: 0, right: 0 }
        leftOut[i] = frame.left
        rightOut[i] = frame.right
      }

      // Defer teardown so we never disconnect the ScriptProcessor mid-callback.
      queueMicrotask(() => {
        maybeLeaveNegativePath()
      })
    }
    processor = node
    return node
  }

  const connectNegativePath = () => {
    const node = ensureNegativeProcessor()
    try {
      source.disconnect()
      delayNode.disconnect()
      node.disconnect()
    } catch {
      // First connect or already disconnected.
    }
    source.connect(node)
    node.connect(delayNode)
    delayNode.connect(context.destination)
    negativePathActive = true
  }

  const syncEarlySkew = (targetEarlyMs: number) => {
    skew = planEarlySkewChange(skew, targetEarlyMs, context.sampleRate)
  }

  if (delayMs < 0) {
    connectNegativePath()
    syncEarlySkew(Math.max(0, -delayMs))
  } else {
    connectPositivePath()
  }
  applyPositiveDelay()

  const resume = () => {
    if (context.state === "suspended") {
      void context.resume()
    }
  }
  resume()

  return {
    mediaElement,
    isNegativePathActive: () => negativePathActive,
    setDelayMs(nextDelayMs: number) {
      const next = clampAudioDelayMs(nextDelayMs)
      if (next === delayMs) {
        return
      }
      delayMs = next
      const earlyMs = Math.max(0, -delayMs)
      if (earlyMs > 0 && !negativePathActive) {
        connectNegativePath()
      }
      applyPositiveDelay()
      syncEarlySkew(earlyMs)
      // Instant leave when pending work cancelled before any audio callbacks.
      maybeLeaveNegativePath()
      resume()
    },
    dispose() {
      try {
        tearDownNegativeProcessor()
        source.disconnect()
        delayNode.disconnect()
      } catch {
        // Element may already be detached on remount.
      }
      pending = []
      void context.close()
    },
  }
}
