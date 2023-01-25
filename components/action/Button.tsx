import { FC, MouseEventHandler, ReactNode } from "react"
import classNames from "classnames"

interface Props {
  id?: string
  tooltip: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
  type?: "button" | "submit" | "reset"
  actionClasses?: string
  disabled?: boolean
  children?: ReactNode
}

const Button: FC<Props> = ({
  id,
  tooltip,
  onClick,
  className = "",
  type = "button",
  actionClasses = "action",
  disabled = false,
  children,
}) => {
  return (
    <button
      id={id}
      data-tooltip-content={tooltip}
      data-tooltip-variant={"dark"}
      onClick={onClick}
      type={type}
      disabled={disabled}
      className={classNames("p-2 rounded", actionClasses, className)}
    >
      {children}
    </button>
  )
}

export default Button
