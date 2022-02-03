import { FC } from "react"
import Icon, { IconProps } from "./Icon"

const IconClose: FC<IconProps> = ({ className = "" }) => {
  return (
    <Icon className={className} sizeClassName={"h-6 w-6"}>
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M6 18L18 6M6 6l12 12'
      />
    </Icon>
  )
}

export default IconClose
