import React, { FC } from "react"
import Alert from "./Alert"
import Button from "../action/Button"
import IconSoundMute from "../icon/IconSoundMute"

interface Props {
  onClick: () => void
}

const AutoplayAlert: FC<Props> = ({ onClick }) => {
  return (
    <Alert className={"rounded opacity-90"}>
      Sound has been muted for autoplay
      <Button className={"p-2 mr-4"} onClick={onClick} tooltip={"Unmute"}>
        <IconSoundMute />
      </Button>
    </Alert>
  )
}

export default AutoplayAlert
