import Button from "../action/Button"
import { FC, ReactNode, useEffect } from "react"
import IconClose from "../icon/IconClose"
import ReactTooltip from "react-tooltip"

interface Props {
  title: ReactNode
  show: boolean
  close: () => void
  children?: ReactNode
}

const Modal: FC<Props> = ({ title, show, close, children }) => {
  useEffect(() => {
    ReactTooltip.rebuild()
  }, [show])

  if (!show) {
    return <></>
  }

  return (
    <div className={"absolute top-0 left-0 h-full w-full z-40"}>
      <div
        onMouseDownCapture={(e) => {
          e.preventDefault()
          e.stopPropagation()
          close()
        }}
        onTouchStartCapture={(e) => {
          e.preventDefault()
          e.stopPropagation()
          close()
        }}
        className={"absolute top-0 left-0 h-full w-full bg-black/50"}
      />
      <div className={"flex justify-center h-full items-center"}>
        <div className={"relative bg-dark-800 shadow rounded z-50 min-w-[30%]"}>
          <div
            className={
              "flex justify-between items-center p-2 border-b-2 border-b-dark-1000"
            }
          >
            <div className={"p-2 mr-2"}>
              <h2 className={"text-xl"}>{title}</h2>
            </div>
            <Button
              tooltip={"Close modal"}
              tooltipFor={"modal"}
              onClick={close}
            >
              <IconClose />
            </Button>
          </div>
          <div className={"p-4"}>{children}</div>
          <div
            className={
              "flex justify-end items-center p-2 border-t-2 border-t-dark-1000"
            }
          >
            <Button
              tooltip={"Close modal"}
              tooltipFor={"modal"}
              className={"p-2 bg-dark-600"}
              onClick={close}
            >
              Close
            </Button>
          </div>
        </div>
      </div>

      <ReactTooltip
        id={"modal"}
        place={"top"}
        type={"dark"}
        effect={"solid"}
        arrowColor={"var(--dark-700)"}
        backgroundColor={"var(--dark-700)"}
        getContent={() => (show ? "Close modal" : null)}
      />
    </div>
  )
}

export default Modal
