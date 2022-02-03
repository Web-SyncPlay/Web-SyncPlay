import { FC } from "react"
import Icon, { IconProps } from "./Icon"

const IconSearch: FC<IconProps> = ({ className = "" }) => {
  return (
    <Icon className={className}>
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        strokeWidth={2}
        d='M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
      />
    </Icon>
  )
}

export default IconSearch
