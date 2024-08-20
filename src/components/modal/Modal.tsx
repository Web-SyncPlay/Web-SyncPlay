import Button from "../action/Button";
import { type ReactNode } from "react";
import { Tooltip } from "react-tooltip";
import { X } from "lucide-react";

export default function Modal({
  title,
  show,
  close,
  children,
}: {
  title: ReactNode;
  show: boolean;
  close: () => void;
  children?: ReactNode;
}) {
  if (!show) {
    return <></>;
  }

  return (
    <div className={"absolute left-0 top-0 z-40 h-full w-full"}>
      <div
        onMouseDownCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
        onTouchStartCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          close();
        }}
        className={"absolute left-0 top-0 h-full w-full bg-black/50"}
      />
      <div className={"flex h-full items-center justify-center"}>
        <div className={"bg-dark-800 relative z-50 min-w-[30%] rounded shadow"}>
          <div
            className={
              "border-b-dark-1000 flex items-center justify-between border-b-2 p-2"
            }
          >
            <div className={"mr-2 p-2"}>
              <h2 className={"text-xl"}>{title}</h2>
            </div>
            <Button tooltip={"Close modal"} id={"closeModal1"} onClick={close}>
              <X />
            </Button>
          </div>
          <div className={"p-4"}>{children}</div>
          <div
            className={
              "border-t-dark-1000 flex items-center justify-end border-t-2 p-2"
            }
          >
            <Button
              tooltip={"Close modal"}
              id={"closeModal2"}
              className={"bg-dark-600 p-2"}
              onClick={close}
            >
              Close
            </Button>
          </div>
        </div>
      </div>

      <Tooltip anchorId={"closeModal1"} />
      <Tooltip anchorId={"closeModal2"} />
    </div>
  );
}
