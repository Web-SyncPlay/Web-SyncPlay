import { FC } from "react"
import Icon, { IconProps } from "./Icon"

const IconBigPause: FC<IconProps> = ({ className = "" }) => {
  return (
    <Icon className={className} sizeClassName={"h-10 w-10"}>
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z'
      />
    </Icon>
  )
}

export default IconBigPause
