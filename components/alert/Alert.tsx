import { FC, ReactNode, useState } from "react"
import IconClose from "../icon/IconClose"
import Button from "../action/Button"
import classNames from "classnames"

export interface AlertProps {
  canClose?: boolean
  className?: string
  children?: ReactNode
}

const Alert: FC<AlertProps> = ({
  canClose = true,
  className = "",
  children,
}) => {
  const [closed, setClosed] = useState(false)
  if (closed) {
    return <></>
  }

  return (
    <div
      className={classNames(
        "rounded bg-dark-800 p-2 flex gap-1 items-center flex-row justify-between",
        className
      )}
    >
      <div className={"flex flex-row gap-1 items-center"}>{children}</div>
      {canClose && (
        <Button tooltip={"Dismiss"} onClick={() => setClosed(true)}>
          <IconClose />
        </Button>
      )}
    </div>
  )
}

export default Alert
