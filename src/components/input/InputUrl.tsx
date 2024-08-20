"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import classNames from "classnames";
import { isUrl } from "../../lib/utils";
import { X } from "lucide-react";

export default function InputUrl({
  url,
  placeholder,
  tooltip,
  onSubmit,
  onChange,
  className,
  children,
}: {
  url: string;
  placeholder: string;
  tooltip: string;
  onSubmit?: () => void;
  onChange: (url: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const [valid, setValid] = useState(url === "" || isUrl(url));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValid(url === "" || isUrl(url));
  }, [url]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (onSubmit) {
          onSubmit();
        }
      }}
      className={classNames("flex flex-col", className)}
    >
      <div
        className={"bg-dark-800 action flex grow flex-row items-center rounded"}
      >
        <input
          ref={inputRef}
          size={1}
          className={classNames("bg-dark-800 grow rounded p-2")}
          placeholder={placeholder}
          value={url}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          type={"text"}
          onFocus={() => inputRef.current?.select()}
        />
        <div className={"cursor-pointer p-1"} onClick={() => onChange("")}>
          <X />
        </div>
        <div>
          <button
            type={"submit"}
            data-tooltip-content={tooltip}
            className={classNames(
              "rounded-r p-2",
              valid
                ? "bg-primary-900 hover:bg-primary-800"
                : "bg-red-600 hover:bg-red-500",
            )}
          >
            {children}
          </button>
        </div>
      </div>
      {!valid && <div className={"text-red-600"}>Invalid url</div>}
    </form>
  );
}
