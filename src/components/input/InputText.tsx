import { type ReactNode, useRef } from "react";
import classNames from "classnames";
import { X } from "lucide-react";

export default function InputText({
  value,
  onChange,
  placeholder,
  icon,
  className = "",
  required = false,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  icon?: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={classNames(
        "bg-dark-800 action flex grow flex-row items-center rounded",
        className,
      )}
    >
      {icon && <div className={"ml-1"}>{icon}</div>}
      <input
        ref={inputRef}
        size={1}
        className={"bg-dark-800 grow rounded px-2 py-1.5" + className}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={"text"}
        required={required}
        onFocus={() => inputRef.current?.select()}
      />
      <div className={"cursor-pointer p-1"} onClick={() => onChange("")}>
        <X />
      </div>
    </div>
  );
}
