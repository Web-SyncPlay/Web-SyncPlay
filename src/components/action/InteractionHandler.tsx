"use client";

import {
  type TouchEvent,
  type MouseEvent,
  type ReactNode,
  useState,
} from "react";

export const LEFT_MOUSE_CLICK = 0;

export default function InteractionHandler({
  tooltip,
  className,
  prevent = true,
  onClick,
  onMove,
  onKey,
  tabIndex,
  children,
}: {
  tooltip?: string;
  className?: string;
  prevent?: boolean;
  onClick?: (
    e: TouchEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
    touch: boolean,
  ) => void;
  onMove?: (
    e: TouchEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
    touch: boolean,
  ) => void;
  tabIndex?: number;
  onKey?: (key: string) => void;
  children?: ReactNode;
}) {
  const [touched, setTouched] = useState(false);
  const [touchedTime, setTouchedTime] = useState(0);

  const touch = () => {
    setTouched(true);
    setTouchedTime(new Date().getTime());

    setTimeout(() => {
      if (new Date().getTime() - touchedTime > 150) {
        setTouched(false);
      }
    }, 200);
  };

  return (
    <div
      data-tooltip-content={tooltip}
      className={className}
      tabIndex={tabIndex}
      onTouchStart={(e) => {
        touch();
        if (onClick) {
          if (prevent) {
            console.log("Prevent default touch start");
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }}
      onTouchEnd={(e) => {
        touch();
        if (onClick) {
          if (prevent) {
            console.log("Prevent default touch end");
            e.preventDefault();
            e.stopPropagation();
          }
          onClick(e, true);
        }
      }}
      onTouchMove={(e) => {
        if (onMove) {
          onMove(e, true);
        }
      }}
      onMouseDown={(_) => {
        // ignored
      }}
      onMouseUp={(e) => {
        if (e.button !== LEFT_MOUSE_CLICK || touched) {
          return;
        }
        if (onClick) {
          onClick(e, false);
        }
      }}
      onMouseMove={(e) => {
        if (onMove) {
          onMove(e, false);
        }
      }}
      onKeyDownCapture={(e) => {
        if (onKey) {
          onKey(e.key);
        }
      }}
    >
      {children}
    </div>
  );
}
