"use client"

import type { PlaylistMediaStream } from "@/contracts/types"
import { Menu } from "@vidstack/react"
import {
  DefaultMenuButton,
  DefaultMenuRadioGroup,
  useDefaultLayoutContext,
} from "@vidstack/react/player/layouts/default"

export function PlayerSourceMenu(props: {
  streams: PlaylistMediaStream[]
  selectedStreamId: string
  onSelectStreamId: (streamId: string) => void
}) {
  const { streams, selectedStreamId, onSelectStreamId } = props
  const { icons: Icons } = useDefaultLayoutContext()

  if (streams.length <= 1) {
    return null
  }

  const selected =
    streams.find((stream) => stream.id === selectedStreamId) ?? streams[0]
  const options = streams.map((stream) => ({
    label: stream.label || stream.id,
    value: stream.id,
  }))

  return (
    <Menu.Root className="vds-menu">
      <DefaultMenuButton
        label="Source"
        hint={selected?.label || selected?.id || "Source"}
        Icon={Icons.Menu.QualityUp}
      />
      <Menu.Items className="vds-menu-items">
        <DefaultMenuRadioGroup
          value={selected?.id ?? selectedStreamId}
          options={options}
          onChange={(streamId) => {
            if (!streamId || streamId === selectedStreamId) {
              return
            }
            onSelectStreamId(streamId)
          }}
        />
      </Menu.Items>
    </Menu.Root>
  )
}
