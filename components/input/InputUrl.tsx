import { FC, ReactNode, useEffect, useRef, useState } from "react"
import classNames from "classnames"
import IconClose from "../icon/IconClose"
import { isUrl } from "../../lib/utils"

interface Props {
  url: string
  placeholder: string
  tooltip: string
  onSubmit?: () => void
  onChange: (url: string) => void
  className?: string
  children?: ReactNode
}

const InputUrl: FC<Props> = ({
  url,
  placeholder,
  tooltip,
  onSubmit,
  onChange,
  className,
  children,
}) => {
  const [valid, setValid] = useState(url === "" || isUrl(url))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setValid(url === "" || isUrl(url))
  }, [url])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (onSubmit) {
          onSubmit()
        }
      }}
      className={classNames("flex flex-col", className)}
    >
      <div
        className={"rounded grow flex flex-row items-center bg-dark-800 action"}
      >
        <input
          ref={inputRef}
          size={1}
          className={classNames("grow rounded bg-dark-800 p-2")}
          placeholder={placeholder}
          value={url}
          onChange={(event) => {
            onChange(event.target.value)
          }}
          type={"text"}
          onFocus={() => inputRef.current?.select()}
        />
        <div className={"p-1 cursor-pointer"} onClick={() => onChange("")}>
          <IconClose />
        </div>
        <div>
          <button
            type={"submit"}
            data-tooltip-content={tooltip}
            className={classNames(
              "p-2 rounded-r",
              valid
                ? "bg-primary-900 hover:bg-primary-800"
                : "bg-red-600 hover:bg-red-500"
            )}
          >
            {children}
          </button>
        </div>
      </div>
      {!valid && <div className={"text-red-600"}>Invalid url</div>}
    </form>
  )
}

export default InputUrl
