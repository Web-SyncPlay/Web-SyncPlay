import ControlButton from "./ControlButton";
import classNames from "classnames";

export default function InputRadio({
  value,
  options,
  setValue,
  interaction,
}: {
  value: string;
  options: string[];
  setValue: (value: string) => void;
  interaction: (touch: boolean) => void;
}) {
  return (
    <>
      {options.map((option) => (
        <ControlButton
          tooltip={"Select " + option}
          key={option}
          interaction={interaction}
          onClick={() => {
            setValue(option);
          }}
          className={classNames(
            "flex items-center justify-between rounded-none py-1",
            value === option ? "bg-dark-800" : "",
          )}
        >
          <span
            className={classNames(
              "mr-2 rounded-full border-4",
              value === option ? "border-green-600" : "border-dark-500",
            )}
          />
          <span>{option}</span>
        </ControlButton>
      ))}
    </>
  );
}
