import React, { FC, ReactNode, useState } from "react"

export const LEFT_MOUSE_CLICK = 0

interface Props {
  tooltip?: string
  className?: string
  prevent?: boolean
  onClick?: (
    e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    touch: boolean
  ) => void
  onMove?: (
    e: React.TouchEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>,
    touch: boolean
  ) => void
  tabIndex?: number
  onKey?: (key: string) => void
  children?: ReactNode
}

const InteractionHandler: FC<Props> = ({
  tooltip,
  className,
  prevent = true,
  onClick,
  onMove,
  onKey,
  tabIndex,
  children,
}) => {
  const [touched, setTouched] = useState(false)
  const [touchedTime, setTouchedTime] = useState(0)

  const touch = () => {
    setTouched(true)
    setTouchedTime(new Date().getTime())

    setTimeout(() => {
      if (new Date().getTime() - touchedTime > 150) {
        setTouched(false)
      }
    }, 200)
  }

  return (
    <div
      data-tooltip-content={tooltip}
      className={className}
      tabIndex={tabIndex}
      onTouchStart={(e) => {
        touch()
        if (onClick) {
          if (prevent) {
            console.log("Prevent default touch start")
            e.preventDefault()
            e.stopPropagation()
          }
        }
      }}
      onTouchEnd={(e) => {
        touch()
        if (onClick) {
          if (prevent) {
            console.log("Prevent default touch end")
            e.preventDefault()
            e.stopPropagation()
          }
          onClick(e, true)
        }
      }}
      onTouchMove={(e) => {
        if (onMove) {
          onMove(e, true)
        }
      }}
      onMouseDown={(_) => {
        // ignored
      }}
      onMouseUp={(e) => {
        if (e.button !== LEFT_MOUSE_CLICK || touched) {
          return
        }
        if (onClick) {
          onClick(e, false)
        }
      }}
      onMouseMove={(e) => {
        if (onMove) {
          onMove(e, false)
        }
      }}
      onKeyDownCapture={(e) => {
        if (onKey) {
          onKey(e.key)
        }
      }}
    >
      {children}
    </div>
  )
}

export default InteractionHandler
