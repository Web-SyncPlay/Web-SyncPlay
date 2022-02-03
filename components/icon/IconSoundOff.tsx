import { FC } from "react"
import Icon, { IconProps } from "./Icon"

const IconSoundOff: FC<IconProps> = ({ className = "" }) => {
  return (
    <Icon className={className} viewBox='0 0 256 512'>
      <path
        fill='currentColor'
        d='M215 71l-89 89H24a24 24 0 0 0-24 24v144a24 24 0 0 0 24 24h102.06L215 441c15 15 41 4.47 41-17V88c0-21.47-26-32-41-17z'
      />
    </Icon>
  )
}

export default IconSoundOff
