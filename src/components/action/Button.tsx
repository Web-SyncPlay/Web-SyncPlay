import { type MouseEventHandler, type ReactNode } from "react";
import classNames from "classnames";

export default function Button({
  id,
  tooltip,
  onClick,
  className = "",
  type = "button",
  actionClasses = "action",
  disabled = false,
  children,
}: {
  id?: string;
  tooltip: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  type?: "button" | "submit" | "reset";
  actionClasses?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      id={id}
      data-tooltip-content={tooltip}
      data-tooltip-variant={"dark"}
      onClick={onClick}
      type={type}
      disabled={disabled}
      className={classNames("rounded p-2", actionClasses, className)}
    >
      {children}
    </button>
  );
}
