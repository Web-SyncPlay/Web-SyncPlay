import { FC, useRef } from "react"
import IconClose from "../icon/IconClose"
import classNames from "classnames"

interface Props {
  value: string
  placeholder: string
  onChange: (value: string) => void
  required?: boolean
  className?: string
  icon?: any
}

const InputText: FC<Props> = ({
  value,
  onChange,
  placeholder,
  icon,
  className = "",
  required = false,
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={classNames(
        "rounded grow flex flex-row items-center bg-dark-800 action",
        className
      )}
    >
      {icon && <div className={"ml-1"}>{icon}</div>}
      <input
        ref={inputRef}
        size={1}
        className={"grow rounded bg-dark-800 px-2 py-1.5" + className}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={"text"}
        required={required}
        onFocus={() => inputRef.current?.select()}
      />
      <div className={"p-1 cursor-pointer"} onClick={() => onChange("")}>
        <IconClose />
      </div>
    </div>
  )
}

export default InputText
