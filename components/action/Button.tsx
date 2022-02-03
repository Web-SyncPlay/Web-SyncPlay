import { FC, MouseEventHandler } from "react"
import classNames from "classnames"

interface Props {
  tooltip: string
  tooltipFor?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  className?: string
  type?: "button" | "submit" | "reset"
  actionClasses?: string
  disabled?: boolean
}

const Button: FC<Props> = ({
  tooltip,
  tooltipFor,
  onClick,
  className = "",
  type = "button",
  actionClasses = "action",
  disabled = false,
  children,
}) => {
  return (
    <button
      data-tip={tooltip}
      data-for={tooltipFor}
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
