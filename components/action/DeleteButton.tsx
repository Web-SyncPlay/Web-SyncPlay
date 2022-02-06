import { FC } from "react"
import ControlButton from "../input/ControlButton"
import IconDelete from "../icon/IconDelete"

interface Props {
  tooltip: string
  onClick: () => void
  className?: string
}

const DeleteButton: FC<Props> = ({ tooltip, onClick }) => {
  return (
    <ControlButton
      className={"transition-colors text-red-600 hover:text-red-500"}
      onClick={onClick}
      interaction={() => {}}
      tooltip={tooltip}
    >
      <IconDelete />
    </ControlButton>
  )
}

export default DeleteButton
