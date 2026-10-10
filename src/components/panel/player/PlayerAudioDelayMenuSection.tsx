"use client"

import {
  AUDIO_DELAY_MAX_MS,
  AUDIO_DELAY_MIN_MS,
  formatAudioDelayLabel,
} from "@/shared/audio-delay"
import { Slider } from "@vidstack/react"
import {
  DefaultMenuSection,
  DefaultMenuSliderItem,
  DefaultSliderParts,
  DefaultSliderSteps,
  useDefaultLayoutContext,
} from "@vidstack/react/player/layouts/default"

const AUDIO_DELAY_STEP_MS = 50

export function PlayerAudioDelayMenuSection(props: {
  delayMs: number
  onDelayChange: (delayMs: number) => void
}) {
  const { delayMs, onDelayChange } = props
  const { icons: Icons } = useDefaultLayoutContext()
  const label = "Audio Delay"
  const valueLabel = formatAudioDelayLabel(delayMs)

  return (
    <DefaultMenuSection label={label} value={valueLabel}>
      <DefaultMenuSliderItem
        UpIcon={Icons.Menu.AudioBoostUp}
        DownIcon={Icons.Menu.AudioBoostDown}
        isMin={delayMs <= AUDIO_DELAY_MIN_MS}
        isMax={delayMs >= AUDIO_DELAY_MAX_MS}
      >
        <Slider.Root
          className="vds-slider"
          aria-label={label}
          min={AUDIO_DELAY_MIN_MS}
          max={AUDIO_DELAY_MAX_MS}
          step={AUDIO_DELAY_STEP_MS}
          keyStep={AUDIO_DELAY_STEP_MS}
          value={delayMs}
          onValueChange={onDelayChange}
          onDragValueChange={onDelayChange}
        >
          <DefaultSliderParts />
          <DefaultSliderSteps />
        </Slider.Root>
      </DefaultMenuSliderItem>
    </DefaultMenuSection>
  )
}
