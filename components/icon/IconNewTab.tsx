import { FC } from "react"
import Icon, { IconProps } from "./Icon"

const IconNewTab: FC<IconProps> = ({
  className = "",
  sizeClassName = "h-6 w-6",
}) => {
  return (
    <Icon className={className} sizeClassName={sizeClassName}>
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
      />
    </Icon>
  )
}

export default IconNewTab
