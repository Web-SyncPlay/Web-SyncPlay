"use client";

import styles from "./InputSlider.module.css";
import {
  type CSSProperties,
  type MouseEventHandler,
  type TouchEventHandler,
  useState,
} from "react";
import classNames from "classnames";
import { Tooltip } from "react-tooltip";
import { secondsToTime } from "../../lib/utils";

export default function InputSlider({
  min = 0,
  max = 1,
  step = 0.001,
  value,
  onChange,
  className = "",
  setSeeking,
  showValueHover = false,
}: {
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  setSeeking?: (seeking: boolean) => void;
  showValueHover?: boolean;
}) {
  const [hoverValue, setHoverValue] = useState(0);
  const [time, setTime] = useState(secondsToTime(hoverValue));

  if (min < 0) {
    console.error("Slider with min value below 0:", min);
    return <></>;
  }

  const valueStyle = {
    "--value": (value / (max - min)) * 100 + "%",
  };

  const startSeek:
    | MouseEventHandler<HTMLInputElement>
    | TouchEventHandler<HTMLInputElement> = () => {
    if (setSeeking) {
      setSeeking(true);
    }
  };

  const stopSeek:
    | MouseEventHandler<HTMLInputElement>
    | TouchEventHandler<HTMLInputElement> = () => {
    if (setSeeking) {
      setSeeking(false);
    }
  };

  const calcSliderPos = (e: React.MouseEvent<HTMLInputElement>) => {
    const target = e.target as HTMLInputElement;
    return (e.nativeEvent.offsetX / target.clientWidth) * max;
  };

  return (
    <div
      className={classNames(styles.slider, "flex items-center px-1", className)}
    >
      <input
        data-tooltip-content={""}
        id={"slider"}
        data-tooltip-variant={"dark"}
        type={"range"}
        min={min}
        max={max}
        step={step}
        value={value}
        onMouseMove={(event) => {
          setHoverValue(calcSliderPos(event));
          setTime(secondsToTime(calcSliderPos(event)));
        }}
        onMouseDown={startSeek as MouseEventHandler}
        onTouchStart={startSeek as TouchEventHandler}
        onMouseUp={stopSeek as MouseEventHandler}
        onTouchEnd={stopSeek as TouchEventHandler}
        onChange={(event) => {
          const v = parseFloat(event.target.value);
          event.target.style.setProperty(
            "--value",
            (v / (max - min)) * 100 + "%",
          );
          onChange(v);
        }}
        style={valueStyle as CSSProperties}
      />
      {showValueHover && (
        <Tooltip
          anchorId={"slider"}
          place={"top"}
          //arrowColor={"var(--dark-700)"}
          content={time}
          style={{
            backgroundColor: "var(--dark-700)",
          }}
        />
      )}
    </div>
  );
}
