import React, { FC, ReactNode, useEffect, useState } from "react"
import ControlButton from "../input/ControlButton"
import classNames from "classnames"

interface Props {
  tooltip: string
  open?: boolean
  className?: string
  menuChange?: (open: boolean) => void
  interaction: (touch: boolean) => void
  buttonContent: ReactNode
  children?: ReactNode
}

const DropUp: FC<Props> = ({
  tooltip,
  open,
  className,
  menuChange,
  interaction,
  buttonContent,
  children,
}) => {
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (typeof open !== "boolean") return

    if (menuOpen !== open) {
      setMenuOpen(open)
      if (menuChange) {
        menuChange(open)
      }
    }
  }, [open, menuChange, menuOpen])

  return (
    <div className={"relative"}>
      {menuOpen && (
        <div
          className={classNames(
            "absolute bottom-[60px] rounded bg-dark-900",
            "transition-height transition-width",
            className
          )}
        >
          {children}
        </div>
      )}
      <ControlButton
        tooltip={(menuOpen ? "Close " : "Open ") + tooltip}
        className={menuOpen ? "bg-dark-800" : ""}
        onClick={() => {
          if (menuChange) {
            menuChange(!menuOpen)
          }
          setMenuOpen(!menuOpen)
        }}
        interaction={interaction}
      >
        {buttonContent}
      </ControlButton>
    </div>
  )
}

export default DropUp
