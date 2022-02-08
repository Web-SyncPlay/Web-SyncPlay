import { FC } from "react"
import ControlButton from "../input/ControlButton"
import InputSlider from "../input/InputSlider"
import IconSoundMute from "../icon/IconSoundMute"
import IconSoundDown from "../icon/IconSoundDown"
import IconSoundOff from "../icon/IconSoundOff"
import IconSoundUp from "../icon/IconSoundUp"

interface Props {
  muted: boolean
  setMuted: (muted: boolean) => void
  volume: number
  setVolume: (volume: number) => void
  interaction: (touch: boolean | null) => void
}

const VolumeControl: FC<Props> = ({
  muted,
  setMuted,
  volume,
  setVolume,
  interaction,
}) => {
  let sound
  if (muted) {
    sound = <IconSoundMute />
  } else if (volume < 0.3) {
    sound = <IconSoundOff />
  } else if (volume < 0.7) {
    sound = <IconSoundDown />
  } else {
    sound = <IconSoundUp />
  }

  return (
    <div className={"flex flex-row items-center"}>
      <ControlButton
        tooltip={muted ? "Unmute" : "Mute"}
        onClick={() => {
          setMuted(!muted)
        }}
        interaction={interaction}
      >
        {sound}
      </ControlButton>
      <InputSlider
        value={muted ? 0 : volume}
        onChange={(newVolume) => {
          if (muted) {
            setMuted(false)
          }
          setVolume(newVolume)
          interaction(null)
        }}
        className={"hide-below-sm"}
      />
    </div>
  )
}

export default VolumeControl
