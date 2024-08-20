"use client";

import { type ReactNode, useState } from "react";
import Button from "../action/Button";
import classNames from "classnames";
import { X } from "lucide-react";

export interface AlertProps {
  canClose?: boolean;
  className?: string;
  children?: ReactNode;
}

export default function Alert({
  canClose = true,
  className = "",
  children,
}: AlertProps) {
  const [closed, setClosed] = useState(false);
  if (closed) {
    return <></>;
  }

  return (
    <div
      className={classNames(
        "bg-dark-800 flex flex-row items-center justify-between gap-1 rounded p-2",
        className,
      )}
    >
      <div className={"flex flex-row items-center gap-1"}>{children}</div>
      {canClose && (
        <Button tooltip={"Dismiss"} onClick={() => setClosed(true)}>
          <X />
        </Button>
      )}
    </div>
  );
}
