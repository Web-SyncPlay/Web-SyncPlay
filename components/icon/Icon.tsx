import { FC, ReactNode } from "react"
import classNames from "classnames"

export interface IconProps {
  sizeClassName?: string
  className?: string
  viewBox?: string
  children?: ReactNode
}

const Icon: FC<IconProps> = ({
  sizeClassName = "h-5 w-5",
  viewBox = "0 0 24 24",
  className = "",
  children,
}) => {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      className={classNames(sizeClassName, className)}
      fill='none'
      viewBox={viewBox}
      stroke='currentColor'
    >
      {children}
    </svg>
  )
}

export default Icon
