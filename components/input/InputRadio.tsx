import { FC } from "react"
import ControlButton from "./ControlButton"
import classNames from "classnames"

interface Props {
  value: string
  options: string[]
  setValue: (value: string) => void
  interaction: (touch: boolean) => void
}

const InputRadio: FC<Props> = ({ value, options, setValue, interaction }) => {
  return (
    <>
      {options.map((option) => (
        <ControlButton
          tooltip={"Select " + option}
          key={option}
          interaction={interaction}
          onClick={() => {
            setValue(option)
          }}
          className={classNames(
            "rounded-none flex justify-between items-center py-1",
            value === option ? "bg-dark-800" : ""
          )}
        >
          <span
            className={classNames(
              "rounded-full border-4 mr-2",
              value === option ? "border-green-600" : "border-dark-500"
            )}
          />
          <span>{option}</span>
        </ControlButton>
      ))}
    </>
  )
}

export default InputRadio
