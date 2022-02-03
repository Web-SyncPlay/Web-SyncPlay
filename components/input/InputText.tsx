import { FC } from "react"
import IconClose from "../icon/IconClose"

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
  return (
    <div
      className={
        "rounded flex flex-row items-center bg-dark-800 action " + className
      }
    >
      {icon && <div className={"ml-1"}>{icon}</div>}
      <input
        className={"rounded grow bg-dark-800 p-2 " + className}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={"text"}
        required={required}
      />
      <div className={"p-1 cursor-pointer"} onClick={() => onChange("")}>
        <IconClose />
      </div>
    </div>
  )
}

export default InputText
