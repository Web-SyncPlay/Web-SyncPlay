import { Trash2 } from "lucide-react";
import ControlButton from "../input/ControlButton";

export default function DeleteButton({
  tooltip,
  onClick,
}: {
  tooltip: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <ControlButton
      className={"text-red-600 transition-colors hover:text-red-500"}
      onClick={onClick}
      interaction={() => null}
      tooltip={tooltip}
    >
      <Trash2 />
    </ControlButton>
  );
}
