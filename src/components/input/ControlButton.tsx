import { type ReactNode } from "react";
import InteractionHandler from "../action/InteractionHandler";
import classNames from "classnames";

export default function ControlButton({
  tooltip,
  className,
  onClick,
  interaction,
  children,
}: {
  tooltip: string;
  className?: string;
  onClick: () => void;
  interaction: (touch: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <InteractionHandler
      tooltip={tooltip}
      className={classNames(
        "action cursor-pointer select-none rounded p-2",
        className,
      )}
      onClick={(e, touch) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
        interaction(touch);
      }}
      onMove={(e, touch) => {
        e.preventDefault();
        e.stopPropagation();
        interaction(touch);
      }}
      prevent={true}
    >
      {children}
    </InteractionHandler>
  );
}
